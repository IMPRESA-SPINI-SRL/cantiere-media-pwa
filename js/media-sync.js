import { LIMITS, STORE_NAMES } from './config.js?v=1.7.0';
import {
  completeMediaCentralSync,
  deleteMediaSyncRecord,
  getMediaBlob,
  getMediaSyncQueue,
  getMediaSyncSummary,
  getRecord,
  setMediaContentHash,
  updateMediaSyncRecord,
} from './db.js?v=1.7.0';
import {
  completeRemoteMediaUpload,
  createRemoteMediaUploadSession,
} from './media-api.js?v=1.7.0';
import { sha256Blob } from './file-hash.js?v=1.7.0';
import { isConnectivityError } from './remote-auth.js?v=1.7.0';

const RANGE_UNIT = 320 * 1024;
const MAX_CHUNK_BYTES = 60 * 1024 * 1024 - RANGE_UNIT;
const DIRECT_REQUEST_TIMEOUT_MS = 120000;
const MAX_DIRECT_RETRIES = 4;
let synchronizationPromise = null;

class UploadSessionExpiredError extends Error {
  constructor() {
    super('Sessione di caricamento scaduta.');
    this.name = 'UploadSessionExpiredError';
    this.code = 'UPLOAD_SESSION_EXPIRED';
  }
}

class DirectUploadError extends Error {
  constructor(message, code, status = 0, payload = null) {
    super(message);
    this.name = 'DirectUploadError';
    this.code = code;
    this.status = status;
    this.payload = payload;
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeCallback(callback, value) {
  try {
    callback?.(value);
  } catch (error) {
    console.warn('Aggiornamento stato sincronizzazione non riuscito.', error);
  }
}

export function normalizeChunkSize(value) {
  const numeric = Number(value);
  const requested = Number.isFinite(numeric) && numeric > 0
    ? Math.min(numeric, MAX_CHUNK_BYTES)
    : LIMITS.MEDIA_UPLOAD_CHUNK_BYTES;
  const normalized = Math.floor(requested / RANGE_UNIT) * RANGE_UNIT;
  return Math.max(RANGE_UNIT, normalized);
}

export function parseNextExpectedOffset(ranges, totalSize = 0) {
  if (!Array.isArray(ranges) || !ranges.length) return Number(totalSize || 0);
  const match = String(ranges[0] || '').match(/^(\d+)(?:-(\d*)?)?$/);
  if (!match) return 0;
  return Number(match[1]);
}

export function computeChunkRange(offset, totalSize, chunkSize) {
  const start = Math.max(0, Number(offset || 0));
  const total = Math.max(0, Number(totalSize || 0));
  const size = normalizeChunkSize(chunkSize);
  if (start >= total) return null;
  const endExclusive = Math.min(total, start + size);
  return {
    start,
    endExclusive,
    endInclusive: endExclusive - 1,
    length: endExclusive - start,
  };
}

async function parsePayload(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  try {
    const text = await response.text();
    return text ? { message: text } : null;
  } catch {
    return null;
  }
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response?.headers?.get?.('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  return Math.min(30000, 1000 * (2 ** attempt));
}

async function directRequest(url, options = {}, { retries = MAX_DIRECT_RETRIES } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DIRECT_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        cache: 'no-store',
      });
      if (response.status === 404) throw new UploadSessionExpiredError();
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        await sleep(retryDelay(response, attempt));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (error instanceof UploadSessionExpiredError) throw error;
      if (attempt >= retries) {
        if (error?.name === 'AbortError' || error?.name === 'TypeError') {
          const networkError = new DirectUploadError(
            'Connessione a OneDrive interrotta.',
            'NETWORK_ERROR',
          );
          networkError.cause = error;
          throw networkError;
        }
        throw error;
      }
      await sleep(Math.min(30000, 1000 * (2 ** attempt)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new DirectUploadError('Caricamento OneDrive non riuscito.', 'UPLOAD_FAILED');
}

async function readUploadSession(uploadUrl) {
  const response = await directRequest(uploadUrl, { method: 'GET' }, { retries: 1 });
  const payload = await parsePayload(response);
  if (!response.ok) {
    throw new DirectUploadError(
      payload?.error?.message || 'Impossibile riprendere il caricamento OneDrive.',
      payload?.error?.code || `UPLOAD_STATUS_${response.status}`,
      response.status,
      payload,
    );
  }
  return payload || {};
}

async function uploadChunk(uploadUrl, blob, range) {
  const response = await directRequest(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Range': `bytes ${range.start}-${range.endInclusive}/${blob.size}`,
    },
    body: blob.slice(range.start, range.endExclusive),
  });
  const payload = await parsePayload(response);

  if (response.status === 416) {
    return { status: 'resume-required', payload };
  }
  if (response.status === 200 || response.status === 201) {
    return { status: 'completed', item: payload || {} };
  }
  if (response.status === 202) {
    return {
      status: 'continue',
      nextOffset: parseNextExpectedOffset(payload?.nextExpectedRanges, range.endExclusive),
      expirationDateTime: payload?.expirationDateTime || '',
    };
  }
  throw new DirectUploadError(
    payload?.error?.message || `OneDrive ha rifiutato il frammento (${response.status}).`,
    payload?.error?.code || `UPLOAD_HTTP_${response.status}`,
    response.status,
    payload,
  );
}

function remoteMediaFromSession(result, fallback = {}) {
  return result?.media || {
    ...fallback,
    status: 'completed',
  };
}

async function prepareUploadSession(media, queueRecord) {
  const expiration = Date.parse(queueRecord.uploadExpiresAt || '');
  if (queueRecord.uploadUrl && Number.isFinite(expiration) && expiration > Date.now() + 30000) {
    try {
      const status = await readUploadSession(queueRecord.uploadUrl);
      return {
        uploadUrl: queueRecord.uploadUrl,
        expirationDateTime: status.expirationDateTime || queueRecord.uploadExpiresAt,
        nextOffset: parseNextExpectedOffset(status.nextExpectedRanges, queueRecord.uploadedBytes || 0),
        chunkSize: normalizeChunkSize(queueRecord.chunkSize),
      };
    } catch (error) {
      if (!(error instanceof UploadSessionExpiredError)) throw error;
      await updateMediaSyncRecord(media.id, {
        uploadUrl: '',
        uploadExpiresAt: '',
        uploadedBytes: 0,
      });
    }
  }

  const result = await createRemoteMediaUploadSession(media);
  if (result.alreadyUploaded) {
    await completeMediaCentralSync(media.id, remoteMediaFromSession(result));
    return { alreadyUploaded: true, remoteMedia: result.media };
  }

  const session = {
    uploadUrl: result.uploadUrl,
    expirationDateTime: result.expirationDateTime || '',
    nextOffset: parseNextExpectedOffset(result.nextExpectedRanges, 0),
    chunkSize: normalizeChunkSize(result.chunkSize),
  };
  await updateMediaSyncRecord(media.id, {
    status: 'uploading',
    uploadUrl: session.uploadUrl,
    uploadExpiresAt: session.expirationDateTime,
    chunkSize: session.chunkSize,
    uploadedBytes: session.nextOffset,
    lastError: '',
  });
  return session;
}

async function ensureMediaContentHash(media, blob) {
  if (/^[a-f0-9]{64}$/i.test(String(media.contentHash || ''))) return media;
  const contentHash = await sha256Blob(blob);
  try {
    await setMediaContentHash(media.id, contentHash);
  } catch (error) {
    // A legacy local duplicate may already own the same unique site/hash key.
    // The central service still safely deduplicates using the calculated hash.
    if (error?.name !== 'ConstraintError') throw error;
  }
  return { ...media, contentHash };
}

async function uploadMedia(media, blob, queueRecord, onProgress) {
  let sessionRestarts = 0;

  while (sessionRestarts < 2) {
    let session;
    try {
      session = await prepareUploadSession(media, queueRecord);
    } catch (error) {
      throw error;
    }
    if (session.alreadyUploaded) return session.remoteMedia;

    let offset = session.nextOffset;
    let finalItem = null;
    try {
      while (offset < blob.size) {
        const range = computeChunkRange(offset, blob.size, session.chunkSize);
        if (!range) break;
        safeCallback(onProgress, {
          phase: 'uploading',
          media,
          uploadedBytes: range.start,
          totalBytes: blob.size,
        });

        const result = await uploadChunk(session.uploadUrl, blob, range);
        if (result.status === 'completed') {
          finalItem = result.item;
          offset = blob.size;
        } else if (result.status === 'resume-required') {
          const status = await readUploadSession(session.uploadUrl);
          offset = parseNextExpectedOffset(status.nextExpectedRanges, range.start);
        } else {
          offset = result.nextOffset;
          if (result.expirationDateTime) session.expirationDateTime = result.expirationDateTime;
        }

        await updateMediaSyncRecord(media.id, {
          status: 'uploading',
          uploadedBytes: offset,
          uploadExpiresAt: session.expirationDateTime,
          lastError: '',
        });
      }
    } catch (error) {
      if (error instanceof UploadSessionExpiredError) {
        sessionRestarts += 1;
        queueRecord = await updateMediaSyncRecord(media.id, {
          uploadUrl: '',
          uploadExpiresAt: '',
          uploadedBytes: 0,
        }) || queueRecord;
        continue;
      }
      throw error;
    }

    const remote = await completeRemoteMediaUpload(media, finalItem?.id || '');
    await completeMediaCentralSync(media.id, remote);
    safeCallback(onProgress, {
      phase: 'completed',
      media,
      uploadedBytes: blob.size,
      totalBytes: blob.size,
      remote,
    });
    return remote;
  }

  throw new UploadSessionExpiredError();
}

function retryTime(attemptCount, error) {
  if (error?.code === 'MEDIA_UPLOAD_IN_PROGRESS') {
    const value = Date.parse(error?.details?.payload?.retryAfter || '');
    if (Number.isFinite(value)) return value;
  }
  const delay = Math.min(
    LIMITS.MEDIA_SYNC_RETRY_MAX_MS,
    15000 * (2 ** Math.min(6, Math.max(0, attemptCount - 1))),
  );
  return Date.now() + delay;
}

function errorMessage(error) {
  if (error?.code === 'MEDIA_UPLOAD_IN_PROGRESS') {
    return 'File già in caricamento da un altro dispositivo.';
  }
  return error?.message || 'Sincronizzazione OneDrive non riuscita.';
}

async function markFailure(mediaId, queueRecord, error) {
  const attemptCount = Number(queueRecord.attemptCount || 0) + 1;
  return updateMediaSyncRecord(mediaId, {
    status: 'failed',
    attemptCount,
    nextAttemptAt: retryTime(attemptCount, error),
    lastError: errorMessage(error).slice(0, 500),
    lastErrorCode: error?.code || error?.name || 'UPLOAD_FAILED',
  });
}

async function runSynchronization({ onProgress, force = false } = {}) {
  if (!navigator.onLine) {
    const summary = await getMediaSyncSummary();
    safeCallback(onProgress, { phase: 'offline', summary });
    return { online: false, ...summary };
  }

  const initialSummary = await getMediaSyncSummary();
  safeCallback(onProgress, { phase: 'starting', summary: initialSummary });
  let completed = 0;
  let failed = 0;
  let processed = 0;
  let stopForNetwork = false;

  while (!stopForNetwork && processed < 500) {
    const queue = await getMediaSyncQueue({
      now: force ? Number.MAX_SAFE_INTEGER : Date.now(),
      limit: LIMITS.MEDIA_SYNC_BATCH_SIZE,
    });
    if (!queue.length) break;

    for (const queueRecord of queue) {
      processed += 1;
      let media = await getRecord(STORE_NAMES.MEDIA, queueRecord.mediaId);
      if (!media) {
        await deleteMediaSyncRecord(queueRecord.mediaId);
        continue;
      }
      const blob = await getMediaBlob(media.id);
      if (!blob) {
        failed += 1;
        await updateMediaSyncRecord(media.id, {
          status: 'failed',
          nextAttemptAt: Number.MAX_SAFE_INTEGER,
          lastError: 'File originale non disponibile sul dispositivo.',
          lastErrorCode: 'LOCAL_BLOB_MISSING',
        });
        safeCallback(onProgress, { phase: 'error', media, error: new Error('File originale non disponibile sul dispositivo.') });
        continue;
      }

      try {
        media = await ensureMediaContentHash(media, blob);
        await updateMediaSyncRecord(media.id, {
          status: 'uploading',
          attemptCount: Number(queueRecord.attemptCount || 0),
          nextAttemptAt: 0,
          lastError: '',
        });
        await uploadMedia(media, blob, queueRecord, onProgress);
        completed += 1;
      } catch (error) {
        failed += 1;
        await markFailure(media.id, queueRecord, error);
        safeCallback(onProgress, { phase: 'error', media, error });
        if (isConnectivityError(error) || error?.code === 'NETWORK_ERROR') {
          stopForNetwork = true;
          break;
        }
      }
    }

    if (force) force = false;
  }

  const summary = await getMediaSyncSummary();
  safeCallback(onProgress, {
    phase: navigator.onLine ? 'idle' : 'offline',
    summary,
    completed,
    failed,
  });
  return {
    online: navigator.onLine,
    completed,
    failed,
    processed,
    ...summary,
  };
}

export function synchronizeMedia(options = {}) {
  if (synchronizationPromise) return synchronizationPromise;
  synchronizationPromise = runSynchronization(options)
    .finally(() => { synchronizationPromise = null; });
  return synchronizationPromise;
}

export function mediaSynchronizationRunning() {
  return Boolean(synchronizationPromise);
}

export { getMediaSyncSummary };
