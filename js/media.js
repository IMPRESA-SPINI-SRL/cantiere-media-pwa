import { LIMITS, MEDIA_TYPES, SITE_STATUSES, STORE_NAMES } from './config.js?v=1.1.0';
import {
  deleteMediaAuthorizedBatch,
  getMediaBlob,
  getRecord,
  getThumbnailBlob,
  putMediaWithBlob,
  putThumbnailBlob,
} from './db.js?v=1.1.0';
import { readExifDate } from './exif.js?v=1.1.0';
import {
  createId,
  fileExtension,
  formatBytes,
  formatDateTime,
  formatDuration,
  isQuotaError,
} from './utils.js?v=1.1.0';

const thumbnailJobs = new Map();
const thumbnailQueue = [];
let activeThumbnailJobs = 0;

export class MediaValidationError extends Error {
  constructor(message, code = 'MEDIA_INVALID') {
    super(message);
    this.name = 'MediaValidationError';
    this.code = code;
  }
}

export function detectMediaType(file) {
  const mime = String(file?.type ?? '').toLowerCase();
  if (mime.startsWith('image/')) return MEDIA_TYPES.PHOTO;
  if (mime.startsWith('video/')) return MEDIA_TYPES.VIDEO;
  const extension = fileExtension(file?.name);
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic', 'heif'].includes(extension)) {
    return MEDIA_TYPES.PHOTO;
  }
  if (['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv'].includes(extension)) {
    return MEDIA_TYPES.VIDEO;
  }
  return null;
}

function waitForEvent(
  target,
  successEvent,
  errorEvent = 'error',
  timeoutMs = 20000,
  trigger = null,
) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => cleanup(new Error('Tempo di lettura del file scaduto.')), timeoutMs);
    const onSuccess = () => cleanup(null);
    const onError = () => cleanup(new Error('Il browser non riesce a leggere questo file.'));
    const cleanup = (error) => {
      clearTimeout(timeout);
      target.removeEventListener(successEvent, onSuccess);
      target.removeEventListener(errorEvent, onError);
      error ? reject(error) : resolve();
    };
    target.addEventListener(successEvent, onSuccess, { once: true });
    target.addEventListener(errorEvent, onError, { once: true });
    try {
      trigger?.();
    } catch (error) {
      cleanup(error);
    }
  });
}

async function inspectPhoto(file) {
  let exifDate = null;
  try {
    exifDate = await readExifDate(file);
  } catch {
    exifDate = null;
  }

  if ('createImageBitmap' in globalThis) {
    try {
      const bitmap = await createImageBitmap(file);
      const result = { width: bitmap.width, height: bitmap.height, exifDate };
      bitmap.close?.();
      return result;
    } catch {
      // Fall through to the image element decoder.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    await waitForEvent(image, 'load', 'error', 20000, () => {
      image.src = url;
    });
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      exifDate,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function inspectVideo(file) {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    await waitForEvent(video, 'loadedmetadata', 'error', 20000, () => {
      video.src = url;
      video.load();
    });
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function inspectMediaFile(file) {
  const mediaType = detectMediaType(file);
  if (!mediaType) {
    throw new MediaValidationError(`Formato non supportato: ${file?.name ?? 'file'}`, 'UNSUPPORTED_FORMAT');
  }
  if (!file.size) {
    throw new MediaValidationError(`Il file ${file.name} e vuoto.`, 'EMPTY_FILE');
  }

  if (mediaType === MEDIA_TYPES.VIDEO && file.size > LIMITS.VIDEO_MAX_BYTES) {
    throw new MediaValidationError(
      `${file.name}: il video supera ${formatBytes(LIMITS.VIDEO_MAX_BYTES)}.`,
      'VIDEO_TOO_LARGE',
    );
  }

  const details = mediaType === MEDIA_TYPES.PHOTO
    ? await inspectPhoto(file)
    : await inspectVideo(file);

  if (mediaType === MEDIA_TYPES.VIDEO && details.duration > LIMITS.VIDEO_MAX_SECONDS) {
    throw new MediaValidationError(
      `${file.name}: durata ${formatDuration(details.duration)}, limite ${formatDuration(LIMITS.VIDEO_MAX_SECONDS)}.`,
      'VIDEO_TOO_LONG',
    );
  }

  const fileDate = Number(file.lastModified) || null;
  const takenAt = details.exifDate || fileDate || Date.now();
  const takenAtSource = details.exifDate ? 'exif' : (fileDate ? 'file' : 'upload');

  return {
    mediaType,
    width: details.width || 0,
    height: details.height || 0,
    duration: details.duration || 0,
    takenAt,
    takenAtSource,
  };
}

export async function saveMediaFile(file, site, user) {
  if (!site?.id) throw new MediaValidationError('Selezionare un cantiere.', 'SITE_REQUIRED');
  if (!user?.id) throw new MediaValidationError('Utente non valido.', 'USER_REQUIRED');

  const [storedSite, storedUser] = await Promise.all([
    getRecord(STORE_NAMES.SITES, site.id),
    getRecord(STORE_NAMES.USERS, user.id),
  ]);
  if (!storedSite || storedSite.status === SITE_STATUSES.DELETING) {
    throw new MediaValidationError('Il cantiere non e piu disponibile.', 'SITE_UNAVAILABLE');
  }
  if (!storedUser || storedUser.active === false) {
    throw new MediaValidationError('L\'utente non e piu attivo.', 'USER_UNAVAILABLE');
  }

  const inspection = await inspectMediaFile(file);
  const uploadDate = Date.now();
  const metadata = {
    id: createId('media'),
    siteId: storedSite.id,
    siteNameSnapshot: storedSite.name,
    authorId: storedUser.id,
    authorNameSnapshot: storedUser.name,
    mediaType: inspection.mediaType,
    fileName: file.name || `${inspection.mediaType}-${uploadDate}`,
    mimeType: file.type || (inspection.mediaType === MEDIA_TYPES.PHOTO ? 'image/jpeg' : 'video/mp4'),
    size: file.size,
    width: inspection.width,
    height: inspection.height,
    duration: inspection.duration,
    takenAt: inspection.takenAt,
    takenAtSource: inspection.takenAtSource,
    uploadDate,
    createdAt: uploadDate,
  };
  try {
    return await putMediaWithBlob(metadata, file);
  } catch (error) {
    if (isQuotaError(error)) {
      throw new MediaValidationError(
        'Spazio locale insufficiente. Liberare memoria sul dispositivo e riprovare.',
        'QUOTA_EXCEEDED',
      );
    }
    throw error;
  }
}

function canvasToBlob(canvas, type = 'image/webp', quality = 0.78) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Impossibile generare la miniatura.'));
    }, type, quality);
  });
}

function drawSquareThumbnail(source, width, height) {
  const size = LIMITS.THUMBNAIL_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas non disponibile.');
  const sourceSide = Math.min(width, height);
  const sourceX = Math.max(0, (width - sourceSide) / 2);
  const sourceY = Math.max(0, (height - sourceSide) / 2);
  context.drawImage(
    source,
    sourceX,
    sourceY,
    sourceSide,
    sourceSide,
    0,
    0,
    size,
    size,
  );
  return canvas;
}

async function generatePhotoThumbnail(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    await waitForEvent(image, 'load', 'error', 20000, () => {
      image.src = url;
    });
    const canvas = drawSquareThumbnail(image, image.naturalWidth, image.naturalHeight);
    try {
      return await canvasToBlob(canvas);
    } catch {
      return canvasToBlob(canvas, 'image/jpeg', 0.8);
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function generateVideoThumbnail(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    await waitForEvent(video, 'loadedmetadata', 'error', 20000, () => {
      video.src = url;
      video.load();
    });
    const targetTime = Math.min(1, Math.max(0, (video.duration || 0) / 3));
    if (targetTime > 0) {
      await waitForEvent(video, 'seeked', 'error', 20000, () => {
        video.currentTime = targetTime;
      });
    } else if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await waitForEvent(video, 'loadeddata');
    }
    const canvas = drawSquareThumbnail(video, video.videoWidth, video.videoHeight);
    try {
      return await canvasToBlob(canvas);
    } catch {
      return canvasToBlob(canvas, 'image/jpeg', 0.8);
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

function placeholderThumbnail(mediaType) {
  const icon = mediaType === MEDIA_TYPES.VIDEO
    ? '<path d="M168 120l132 90-132 90z" fill="white"/>'
    : '<path d="M95 300l85-92 60 60 45-48 72 80z" fill="white"/><circle cx="150" cy="145" r="30" fill="white"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="420" viewBox="0 0 420 420"><rect width="420" height="420" fill="#4b5563"/>${icon}</svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

function runThumbnailQueue() {
  while (activeThumbnailJobs < LIMITS.THUMBNAIL_CONCURRENCY && thumbnailQueue.length) {
    const job = thumbnailQueue.shift();
    activeThumbnailJobs += 1;
    job.task()
      .then(job.resolve, job.reject)
      .finally(() => {
        activeThumbnailJobs -= 1;
        runThumbnailQueue();
      });
  }
}

function enqueueThumbnail(task) {
  return new Promise((resolve, reject) => {
    thumbnailQueue.push({ task, resolve, reject });
    runThumbnailQueue();
  });
}

export async function getOrCreateThumbnail(media) {
  const cached = await getThumbnailBlob(media.id);
  if (cached) return cached;
  if (thumbnailJobs.has(media.id)) return thumbnailJobs.get(media.id);

  const job = enqueueThumbnail(async () => {
    const secondCheck = await getThumbnailBlob(media.id);
    if (secondCheck) return secondCheck;
    const original = await getMediaBlob(media.id);
    if (!original) throw new Error('File originale non trovato.');
    let thumbnail;
    try {
      thumbnail = media.mediaType === MEDIA_TYPES.VIDEO
        ? await generateVideoThumbnail(original)
        : await generatePhotoThumbnail(original);
    } catch {
      thumbnail = placeholderThumbnail(media.mediaType);
    }
    await putThumbnailBlob(media.id, thumbnail);
    return thumbnail;
  }).finally(() => thumbnailJobs.delete(media.id));

  thumbnailJobs.set(media.id, job);
  return job;
}

export async function getMediaFile(media) {
  const blob = await getMediaBlob(media.id);
  if (!blob) throw new Error('File non trovato nel dispositivo.');
  return new File([blob], media.fileName, {
    type: media.mimeType || blob.type,
    lastModified: media.takenAt || media.uploadDate,
  });
}

export function partitionMediaByType(items) {
  return items.reduce((groups, media) => {
    if (media?.mediaType === MEDIA_TYPES.PHOTO) groups.photos.push(media);
    if (media?.mediaType === MEDIA_TYPES.VIDEO) groups.videos.push(media);
    return groups;
  }, { photos: [], videos: [] });
}

export async function shareMediaItems(items) {
  if (!items.length) return;
  if (!navigator.share) {
    throw new MediaValidationError('Condivisione di sistema non disponibile.', 'SHARE_UNAVAILABLE');
  }
  const files = await Promise.all(items.map((media) => getMediaFile(media)));
  const payload = { files, title: 'Media cantiere' };
  if (navigator.canShare && !navigator.canShare(payload)) {
    throw new MediaValidationError('Il dispositivo non supporta la condivisione di questi file.', 'SHARE_FILES_UNSUPPORTED');
  }
  await navigator.share(payload);
}

export async function downloadMedia(media) {
  const file = await getMediaFile(media);
  const url = URL.createObjectURL(file);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function deleteMediaItems(actor, mediaIds) {
  if (!actor?.id) throw new Error('Sessione non valida.');
  const uniqueIds = [...new Set(mediaIds.filter(Boolean))];
  const result = { deleted: [], denied: [], missing: [] };

  for (let offset = 0; offset < uniqueIds.length; offset += LIMITS.MEDIA_DELETE_BATCH_SIZE) {
    const batch = uniqueIds.slice(offset, offset + LIMITS.MEDIA_DELETE_BATCH_SIZE);
    try {
      const batchResult = await deleteMediaAuthorizedBatch(actor.id, batch, Date.now());
      result.deleted.push(...batchResult.deleted);
      result.denied.push(...batchResult.denied);
      result.missing.push(...batchResult.missing);
    } catch (error) {
      error.deletionResult = result;
      throw error;
    }
  }
  return result;
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function getStorageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return {
      usage,
      quota,
      available: Math.max(0, quota - usage),
    };
  } catch {
    return null;
  }
}

export function mediaDescription(media) {
  const parts = [
    media.mediaType === MEDIA_TYPES.VIDEO ? 'Video' : 'Foto',
    media.authorNameSnapshot,
    formatDateTime(media.takenAt),
    formatBytes(media.size),
  ];
  if (media.mediaType === MEDIA_TYPES.VIDEO) parts.push(formatDuration(media.duration));
  return parts.filter(Boolean).join(' - ');
}

export async function mediaExists(mediaId) {
  return Boolean(await getRecord(STORE_NAMES.MEDIA, mediaId));
}
