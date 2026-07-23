export const APP_NAME = 'Cantiere Media';
export const APP_VERSION = '1.7.0';
export const API_BASE_URL = 'https://func-cantiere-media-spini-prod-cbaudcavfabuemex.italynorth-01.azurewebsites.net';
export const DB_NAME = 'cantiere-media-db';
export const DB_VERSION = 5;

export const ROLES = Object.freeze({
  ADMIN: 'admin',
  USER: 'user',
});

export const MEDIA_TYPES = Object.freeze({
  PHOTO: 'photo',
  VIDEO: 'video',
});

export const VIEW_MODES = Object.freeze({
  UPLOAD: 'upload',
  ARCHIVE: 'archive',
});

export const MEDIA_FILTERS = Object.freeze({
  PHOTO: 'photo',
  VIDEO: 'video',
  BOTH: 'both',
});

export const ALL_SITES_ID = '__all_sites__';

export const SITE_STATUSES = Object.freeze({
  ACTIVE: 'active',
  COMPLETED: 'completed',
  DELETING: 'deleting',
});

export const LIMITS = Object.freeze({
  PAGE_SIZE: 60,
  THUMBNAIL_SIZE: 420,
  THUMBNAIL_CONCURRENCY: 2,
  VIDEO_MAX_SECONDS: 180,
  VIDEO_MAX_BYTES: 500 * 1024 * 1024,
  DELETE_WINDOW_MS: 24 * 60 * 60 * 1000,
  SITE_DELETE_BATCH_SIZE: 100,
  PIN_MIN_LENGTH: 6,
  PIN_MAX_LENGTH: 6,
  PIN_PBKDF2_ITERATIONS: 160000,
  AUTH_MAX_FAILURES: 5,
  AUTH_LOCK_MS: 30 * 1000,
  MEDIA_DELETE_BATCH_SIZE: 100,
  MEDIA_SYNC_BATCH_SIZE: 20,
  MEDIA_UPLOAD_CHUNK_BYTES: 5 * 1024 * 1024,
  MEDIA_SYNC_RETRY_MAX_MS: 15 * 60 * 1000,
});

export const STORE_NAMES = Object.freeze({
  USERS: 'users',
  SITES: 'sites',
  MEDIA: 'media',
  MEDIA_BLOBS: 'mediaBlobs',
  MEDIA_SYNC: 'mediaSync',
  THUMBNAILS: 'thumbnails',
  SETTINGS: 'settings',
  FAVORITES: 'favorites',
});
