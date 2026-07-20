export const APP_NAME = 'Cantiere Media';
export const APP_VERSION = '1.0.3';
export const DB_NAME = 'cantiere-media-db';
export const DB_VERSION = 1;

export const ROLES = Object.freeze({
  ADMIN: 'admin',
  USER: 'user',
});

export const MEDIA_TYPES = Object.freeze({
  PHOTO: 'photo',
  VIDEO: 'video',
});

export const FAVORITE_CONTEXTS = Object.freeze({
  ARCHIVE: 'archive',
  UPLOAD: 'upload',
});

export const VIEW_MODES = Object.freeze({
  ARCHIVE: 'archive',
  MY_UPLOADS: 'my-uploads',
  FAVORITE_ARCHIVE: 'favorite-archive',
  FAVORITE_UPLOADS: 'favorite-uploads',
});

export const MEDIA_FILTERS = Object.freeze({
  PHOTO: 'photo',
  VIDEO: 'video',
  BOTH: 'both',
});

export const SITE_STATUSES = Object.freeze({
  ACTIVE: 'active',
  COMPLETED: 'completed',
  DELETING: 'deleting',
});

export const LIMITS = Object.freeze({
  PAGE_SIZE: 60,
  THUMBNAIL_SIZE: 420,
  THUMBNAIL_CONCURRENCY: 2,
  VIDEO_MAX_SECONDS: 60,
  VIDEO_MAX_BYTES: 100 * 1024 * 1024,
  DELETE_WINDOW_MS: 24 * 60 * 60 * 1000,
  SITE_DELETE_BATCH_SIZE: 100,
  PIN_MIN_LENGTH: 4,
  PIN_MAX_LENGTH: 8,
  PIN_PBKDF2_ITERATIONS: 160000,
  AUTH_MAX_FAILURES: 5,
  AUTH_LOCK_MS: 30 * 1000,
  MEDIA_DELETE_BATCH_SIZE: 100,
});

export const STORE_NAMES = Object.freeze({
  USERS: 'users',
  SITES: 'sites',
  MEDIA: 'media',
  MEDIA_BLOBS: 'mediaBlobs',
  THUMBNAILS: 'thumbnails',
  SETTINGS: 'settings',
  FAVORITES: 'favorites',
});
