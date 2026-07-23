import { centralApiRequest } from './remote-auth.js?v=1.7.0';

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
  };
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
