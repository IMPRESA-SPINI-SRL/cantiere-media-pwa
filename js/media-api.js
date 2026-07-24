import { ALL_SITES_ID } from './config.js?v=1.8.1';
import { centralApiBlobRequest, centralApiRequest } from './remote-auth.js?v=1.8.1';

const accessCache = new Map();

function mediaPayload(media) {
  return {
    mediaId: media.id,
    siteId: media.siteId,
    contentHash: media.contentHash,
    mediaType: media.mediaType,
    size: Number(media.size || 0),
    fileName: media.fileName,
    mimeType: media.mimeType || 'application/octet-stream',
    takenAt: Number(media.takenAt || media.uploadDate || Date.now()),
    authorId: media.authorId || '',
    authorName: media.authorNameSnapshot || '',
    width: Number(media.width || 0),
    height: Number(media.height || 0),
    duration: Number(media.duration || 0),
  };
}

function mediaReference(media) {
  return {
    siteId: media?.siteId || '',
    contentHash: media?.contentHash || media?.centralContentHash || '',
  };
}

function accessCacheKey(media) {
  const reference = mediaReference(media);
  return `${reference.siteId}::${reference.contentHash}`;
}

function accessStillValid(value) {
  const expiry = Date.parse(value?.expiresAt || '');
  return Boolean(value?.downloadUrl) && Number.isFinite(expiry) && expiry > Date.now() + 60000;
}

export async function createRemoteMediaUploadSession(media) {
  return centralApiRequest('/api/media/upload-session', {
    method: 'POST',
    body: mediaPayload(media),
    timeoutMs: 60000,
  });
}

export async function completeRemoteMediaUpload(media, driveItemId = '') {
  const result = await centralApiRequest('/api/media/complete', {
    method: 'POST',
    body: {
      ...mediaPayload(media),
      driveItemId,
    },
    timeoutMs: 60000,
  });
  return result.media;
}

export async function listRemoteMediaChanges({
  siteId = ALL_SITES_ID,
  since = '',
  cursor = '',
  limit = 200,
} = {}) {
  const query = new URLSearchParams({
    siteId: siteId || ALL_SITES_ID,
    limit: String(Math.max(1, Math.min(200, Number(limit) || 200))),
  });
  if (since) query.set('since', since);
  if (cursor) query.set('cursor', cursor);
  return centralApiRequest(`/api/media/changes?${query.toString()}`, {
    timeoutMs: 60000,
  });
}

export async function getRemoteMediaAccess(media, { force = false } = {}) {
  const reference = mediaReference(media);
  if (!reference.siteId || !reference.contentHash) {
    throw new Error('Riferimento del media centrale non valido.');
  }

  const key = accessCacheKey(media);
  const cached = accessCache.get(key);
  if (!force && accessStillValid(cached)) return cached;

  const result = await centralApiRequest('/api/media/access', {
    method: 'POST',
    body: reference,
    timeoutMs: 60000,
  });
  const access = {
    downloadUrl: result.downloadUrl || '',
    thumbnailUrl: result.thumbnailUrl || '',
    expiresAt: result.expiresAt || '',
    media: result.media || null,
  };
  accessCache.set(key, access);
  return access;
}

export async function getRemoteMediaThumbnail(media) {
  const reference = mediaReference(media);
  if (!reference.siteId || !reference.contentHash) {
    throw new Error('Riferimento del media centrale non valido.');
  }
  return centralApiBlobRequest('/api/media/thumbnail', {
    method: 'POST',
    body: reference,
    timeoutMs: 90000,
  });
}

export async function deleteRemoteMedia(media) {
  const reference = mediaReference(media);
  if (!reference.siteId || !reference.contentHash) {
    throw new Error('Riferimento del media centrale non valido.');
  }
  const result = await centralApiRequest('/api/media/delete', {
    method: 'POST',
    body: reference,
    timeoutMs: 60000,
  });
  accessCache.delete(accessCacheKey(media));
  return result;
}

export function clearRemoteMediaAccessCache(media = null) {
  if (!media) accessCache.clear();
  else accessCache.delete(accessCacheKey(media));
}
