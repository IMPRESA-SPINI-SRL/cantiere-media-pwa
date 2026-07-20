import {
  DB_NAME,
  DB_VERSION,
  LIMITS,
  MEDIA_FILTERS,
  SITE_STATUSES,
  STORE_NAMES,
} from './config.js?v=1.0.3';
import { canDeleteMedia } from './permissions.js?v=1.0.3';
import { endOfLocalDay, startOfLocalDay } from './utils.js?v=1.0.3';

let databasePromise = null;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });
}

function ensureIndex(store, name, keyPath, options = {}) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options);
  }
}

function configureSchema(database, transaction) {
  const users = database.objectStoreNames.contains(STORE_NAMES.USERS)
    ? transaction.objectStore(STORE_NAMES.USERS)
    : database.createObjectStore(STORE_NAMES.USERS, { keyPath: 'id' });
  ensureIndex(users, 'role', 'role');
  ensureIndex(users, 'nameNormalized', 'nameNormalized', { unique: true });
  ensureIndex(users, 'createdAt', 'createdAt');

  const sites = database.objectStoreNames.contains(STORE_NAMES.SITES)
    ? transaction.objectStore(STORE_NAMES.SITES)
    : database.createObjectStore(STORE_NAMES.SITES, { keyPath: 'id' });
  ensureIndex(sites, 'status', 'status');
  ensureIndex(sites, 'nameNormalized', 'nameNormalized', { unique: true });
  ensureIndex(sites, 'updatedAt', 'updatedAt');

  const media = database.objectStoreNames.contains(STORE_NAMES.MEDIA)
    ? transaction.objectStore(STORE_NAMES.MEDIA)
    : database.createObjectStore(STORE_NAMES.MEDIA, { keyPath: 'id' });
  ensureIndex(media, 'siteId', 'siteId');
  ensureIndex(media, 'author', 'authorId');
  ensureIndex(media, 'mediaType', 'mediaType');
  ensureIndex(media, 'date', 'takenAt');
  ensureIndex(media, 'uploadDate', 'uploadDate');
  ensureIndex(media, 'siteDate', ['siteId', 'takenAt', 'id']);
  ensureIndex(media, 'siteTypeDate', ['siteId', 'mediaType', 'takenAt', 'id']);
  ensureIndex(media, 'siteAuthorDate', ['siteId', 'authorId', 'takenAt', 'id']);
  ensureIndex(media, 'siteTypeAuthorDate', ['siteId', 'mediaType', 'authorId', 'takenAt', 'id']);

  if (!database.objectStoreNames.contains(STORE_NAMES.MEDIA_BLOBS)) {
    database.createObjectStore(STORE_NAMES.MEDIA_BLOBS, { keyPath: 'mediaId' });
  }

  if (!database.objectStoreNames.contains(STORE_NAMES.THUMBNAILS)) {
    database.createObjectStore(STORE_NAMES.THUMBNAILS, { keyPath: 'mediaId' });
  }

  if (!database.objectStoreNames.contains(STORE_NAMES.SETTINGS)) {
    database.createObjectStore(STORE_NAMES.SETTINGS, { keyPath: 'key' });
  }

  const favorites = database.objectStoreNames.contains(STORE_NAMES.FAVORITES)
    ? transaction.objectStore(STORE_NAMES.FAVORITES)
    : database.createObjectStore(STORE_NAMES.FAVORITES, { keyPath: 'id' });
  ensureIndex(favorites, 'userId', 'userId');
  ensureIndex(favorites, 'mediaId', 'mediaId');
  ensureIndex(favorites, 'context', 'context');
  ensureIndex(favorites, 'favorite', 'favorite');
  ensureIndex(favorites, 'userContextMedia', ['userId', 'context', 'mediaId'], { unique: true });
  ensureIndex(favorites, 'userContextSiteDate', ['userId', 'context', 'siteId', 'takenAt', 'mediaId']);
  ensureIndex(favorites, 'userContextSiteTypeDate', ['userId', 'context', 'siteId', 'mediaType', 'takenAt', 'mediaId']);
  ensureIndex(favorites, 'userContextSiteAuthorDate', ['userId', 'context', 'siteId', 'authorId', 'takenAt', 'mediaId']);
  ensureIndex(favorites, 'userContextSiteTypeAuthorDate', ['userId', 'context', 'siteId', 'mediaType', 'authorId', 'takenAt', 'mediaId']);
}

export function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => configureSchema(request.result, request.transaction);
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error('Database opening failed.'));
    request.onblocked = () => {
      globalThis.dispatchEvent?.(new CustomEvent('app:database-blocked'));
    };
  });

  return databasePromise;
}

export async function getRecord(storeName, key) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readonly');
  return requestToPromise(transaction.objectStore(storeName).get(key));
}

export async function putRecord(storeName, value) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).put(value);
  await transactionToPromise(transaction);
  return value;
}

export async function putInitialUser(record) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAMES.USERS, 'readwrite');
  const store = transaction.objectStore(STORE_NAMES.USERS);
  let domainError = null;

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(record);
    transaction.onabort = () => reject(
      domainError
      ?? transaction.error
      ?? new Error('Creazione dell\'amministratore non riuscita.'),
    );
    transaction.onerror = () => {
      // The abort handler reports the final transaction error.
    };

    const countRequest = store.count();
    countRequest.onsuccess = () => {
      if (countRequest.result > 0) {
        domainError = new Error('Il primo amministratore e gia stato configurato.');
        domainError.code = 'SETUP_ALREADY_COMPLETED';
        transaction.abort();
        return;
      }
      store.add(record);
    };
  });
}

export async function deleteRecord(storeName, key) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).delete(key);
  await transactionToPromise(transaction);
}

export async function getAllRecords(storeName) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readonly');
  return requestToPromise(transaction.objectStore(storeName).getAll());
}

export async function getAllByIndex(storeName, indexName, query) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readonly');
  return requestToPromise(transaction.objectStore(storeName).index(indexName).getAll(query));
}

export async function countByIndex(storeName, indexName, query) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readonly');
  return requestToPromise(transaction.objectStore(storeName).index(indexName).count(query));
}

export async function getSetting(key, fallback = null) {
  const record = await getRecord(STORE_NAMES.SETTINGS, key);
  return record ? record.value : fallback;
}

export async function setSetting(key, value) {
  return putRecord(STORE_NAMES.SETTINGS, { key, value, updatedAt: Date.now() });
}

export async function deleteSetting(key) {
  return deleteRecord(STORE_NAMES.SETTINGS, key);
}

export async function putMediaWithBlob(metadata, blob) {
  const database = await openDatabase();
  const transaction = database.transaction(
    [
      STORE_NAMES.USERS,
      STORE_NAMES.SITES,
      STORE_NAMES.MEDIA,
      STORE_NAMES.MEDIA_BLOBS,
    ],
    'readwrite',
  );
  const users = transaction.objectStore(STORE_NAMES.USERS);
  const sites = transaction.objectStore(STORE_NAMES.SITES);
  const media = transaction.objectStore(STORE_NAMES.MEDIA);
  const mediaBlobs = transaction.objectStore(STORE_NAMES.MEDIA_BLOBS);
  const siteRequest = sites.get(metadata.siteId);
  const userRequest = users.get(metadata.authorId);
  let siteLoaded = false;
  let userLoaded = false;
  let finalMetadata = metadata;
  let domainError = null;

  return new Promise((resolve, reject) => {
    const writeWhenValidated = () => {
      if (!siteLoaded || !userLoaded) return;
      const site = siteRequest.result;
      const user = userRequest.result;
      if (!site || site.status === SITE_STATUSES.DELETING) {
        domainError = new Error('Il cantiere non e piu disponibile.');
        domainError.code = 'SITE_UNAVAILABLE';
        transaction.abort();
        return;
      }
      if (!user || user.active === false) {
        domainError = new Error('L\'utente non e piu attivo.');
        domainError.code = 'USER_UNAVAILABLE';
        transaction.abort();
        return;
      }

      finalMetadata = {
        ...metadata,
        siteNameSnapshot: site.name,
        authorNameSnapshot: user.name,
      };
      media.add(finalMetadata);
      mediaBlobs.add({ mediaId: metadata.id, blob });
    };

    siteRequest.onsuccess = () => {
      siteLoaded = true;
      writeWhenValidated();
    };
    userRequest.onsuccess = () => {
      userLoaded = true;
      writeWhenValidated();
    };
    transaction.oncomplete = () => resolve(finalMetadata);
    transaction.onabort = () => reject(
      domainError
      ?? transaction.error
      ?? new Error('Salvataggio del media non riuscito.'),
    );
    transaction.onerror = () => {
      // The abort handler reports the final transaction error.
    };
  });
}

export function chooseMediaQueryPlan(filters) {
  const hasType = filters.mediaType && filters.mediaType !== MEDIA_FILTERS.BOTH;
  const hasAuthor = filters.authorId && filters.authorId !== 'all';

  if (hasType && hasAuthor) {
    return {
      indexName: 'siteTypeAuthorDate',
      prefix: [filters.siteId, filters.mediaType, filters.authorId],
    };
  }
  if (hasType) {
    return {
      indexName: 'siteTypeDate',
      prefix: [filters.siteId, filters.mediaType],
    };
  }
  if (hasAuthor) {
    return {
      indexName: 'siteAuthorDate',
      prefix: [filters.siteId, filters.authorId],
    };
  }
  return {
    indexName: 'siteDate',
    prefix: [filters.siteId],
  };
}

export function chooseFavoriteQueryPlan(filters) {
  const hasType = filters.mediaType && filters.mediaType !== MEDIA_FILTERS.BOTH;
  const hasAuthor = filters.authorId && filters.authorId !== 'all';
  const base = [filters.userId, filters.context, filters.siteId];

  if (hasType && hasAuthor) {
    return {
      indexName: 'userContextSiteTypeAuthorDate',
      prefix: [...base, filters.mediaType, filters.authorId],
    };
  }
  if (hasType) {
    return {
      indexName: 'userContextSiteTypeDate',
      prefix: [...base, filters.mediaType],
    };
  }
  if (hasAuthor) {
    return {
      indexName: 'userContextSiteAuthorDate',
      prefix: [...base, filters.authorId],
    };
  }
  return {
    indexName: 'userContextSiteDate',
    prefix: base,
  };
}

function createDescendingRange(prefix, date, cursorKey = null) {
  const lower = [
    ...prefix,
    startOfLocalDay(date),
    '',
  ];
  const normalUpper = [
    ...prefix,
    endOfLocalDay(date),
    '\uffff',
  ];
  const upper = cursorKey ?? normalUpper;
  return IDBKeyRange.bound(lower, upper, false, cursorKey !== null);
}

async function queryIndexPage(storeName, plan, date, cursorKey, limit) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readonly');
  const index = transaction.objectStore(storeName).index(plan.indexName);
  const range = createDescendingRange(plan.prefix, date, cursorKey);

  return new Promise((resolve, reject) => {
    const items = [];
    let lastKey = null;
    let hasMore = false;
    const request = index.openCursor(range, 'prev');

    request.onerror = () => reject(request.error ?? new Error('Indexed query failed.'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve({ items, nextCursor: null });
        return;
      }
      if (items.length >= limit) {
        hasMore = true;
        resolve({ items, nextCursor: hasMore ? lastKey : null });
        return;
      }
      items.push(cursor.value);
      lastKey = cursor.key;
      cursor.continue();
    };
  });
}

export async function queryMediaPage(filters, cursorKey = null, limit = LIMITS.PAGE_SIZE) {
  if (!filters.siteId) return { items: [], nextCursor: null };
  return queryIndexPage(
    STORE_NAMES.MEDIA,
    chooseMediaQueryPlan(filters),
    filters.date,
    cursorKey,
    limit,
  );
}

export async function queryFavoritePage(filters, cursorKey = null, limit = LIMITS.PAGE_SIZE) {
  if (!filters.siteId || !filters.userId || !filters.context) {
    return { items: [], nextCursor: null };
  }
  const page = await queryIndexPage(
    STORE_NAMES.FAVORITES,
    chooseFavoriteQueryPlan(filters),
    filters.date,
    cursorKey,
    limit,
  );
  const media = await getMediaMany(page.items.map((favorite) => favorite.mediaId));
  const byId = new Map(media.filter(Boolean).map((item) => [item.id, item]));
  return {
    items: page.items.map((favorite) => byId.get(favorite.mediaId)).filter(Boolean),
    nextCursor: page.nextCursor,
  };
}

export async function getMediaMany(ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return [];
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAMES.MEDIA, 'readonly');
  const completion = transactionToPromise(transaction);
  const store = transaction.objectStore(STORE_NAMES.MEDIA);
  const requests = uniqueIds.map((id) => requestToPromise(store.get(id)));
  const values = await Promise.all(requests);
  await completion;
  return values;
}

export async function getMediaBlob(mediaId) {
  const record = await getRecord(STORE_NAMES.MEDIA_BLOBS, mediaId);
  return record?.blob ?? null;
}

export async function getThumbnailBlob(mediaId) {
  const record = await getRecord(STORE_NAMES.THUMBNAILS, mediaId);
  return record?.blob ?? null;
}

export async function putThumbnailBlob(mediaId, blob) {
  const database = await openDatabase();
  const transaction = database.transaction(
    [STORE_NAMES.MEDIA, STORE_NAMES.THUMBNAILS],
    'readwrite',
  );
  const media = transaction.objectStore(STORE_NAMES.MEDIA);
  const thumbnails = transaction.objectStore(STORE_NAMES.THUMBNAILS);
  let stored = false;

  return new Promise((resolve, reject) => {
    const mediaRequest = media.get(mediaId);
    mediaRequest.onsuccess = () => {
      if (!mediaRequest.result) return;
      stored = true;
      thumbnails.put({
        mediaId,
        blob,
        generatedAt: Date.now(),
      });
    };
    transaction.oncomplete = () => resolve(stored);
    transaction.onabort = () => reject(
      transaction.error ?? new Error('Salvataggio della miniatura non riuscito.'),
    );
    transaction.onerror = () => {
      // The abort handler reports the final transaction error.
    };
  });
}

export async function countMediaForSite(siteId) {
  if (!siteId) return 0;
  return countByIndex(STORE_NAMES.MEDIA, 'siteId', IDBKeyRange.only(siteId));
}

export async function getMediaIdsForSite(siteId, limit = LIMITS.SITE_DELETE_BATCH_SIZE) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAMES.MEDIA, 'readonly');
  const index = transaction.objectStore(STORE_NAMES.MEDIA).index('siteId');
  const range = IDBKeyRange.only(siteId);

  return new Promise((resolve, reject) => {
    const ids = [];
    const request = index.openKeyCursor(range);
    request.onerror = () => reject(request.error ?? new Error('Cannot read site media.'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || ids.length >= limit) {
        resolve(ids);
        return;
      }
      ids.push(cursor.primaryKey);
      cursor.continue();
    };
  });
}

export async function deleteMediaCascade(ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return;

  const database = await openDatabase();
  const transaction = database.transaction(
    [
      STORE_NAMES.MEDIA,
      STORE_NAMES.MEDIA_BLOBS,
      STORE_NAMES.THUMBNAILS,
      STORE_NAMES.FAVORITES,
    ],
    'readwrite',
  );
  const mediaStore = transaction.objectStore(STORE_NAMES.MEDIA);
  const blobStore = transaction.objectStore(STORE_NAMES.MEDIA_BLOBS);
  const thumbnailStore = transaction.objectStore(STORE_NAMES.THUMBNAILS);
  const favoriteStore = transaction.objectStore(STORE_NAMES.FAVORITES);
  const favoriteMediaIndex = favoriteStore.index('mediaId');

  for (const mediaId of uniqueIds) {
    mediaStore.delete(mediaId);
    blobStore.delete(mediaId);
    thumbnailStore.delete(mediaId);

    const cursorRequest = favoriteMediaIndex.openKeyCursor(IDBKeyRange.only(mediaId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      favoriteStore.delete(cursor.primaryKey);
      cursor.continue();
    };
  }

  await transactionToPromise(transaction);
}

export async function deleteMediaAuthorizedBatch(actorId, ids, now = Date.now()) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!actorId || !uniqueIds.length) {
    return { deleted: [], denied: [], missing: [] };
  }

  const database = await openDatabase();
  const transaction = database.transaction(
    [
      STORE_NAMES.USERS,
      STORE_NAMES.MEDIA,
      STORE_NAMES.MEDIA_BLOBS,
      STORE_NAMES.THUMBNAILS,
      STORE_NAMES.FAVORITES,
    ],
    'readwrite',
  );
  const users = transaction.objectStore(STORE_NAMES.USERS);
  const media = transaction.objectStore(STORE_NAMES.MEDIA);
  const mediaBlobs = transaction.objectStore(STORE_NAMES.MEDIA_BLOBS);
  const thumbnails = transaction.objectStore(STORE_NAMES.THUMBNAILS);
  const favorites = transaction.objectStore(STORE_NAMES.FAVORITES);
  const favoriteMediaIndex = favorites.index('mediaId');
  const actorRequest = users.get(actorId);
  const mediaRequests = uniqueIds.map((mediaId) => ({
    mediaId,
    request: media.get(mediaId),
    loaded: false,
  }));
  let actorLoaded = false;
  let completedRequests = 0;
  let domainError = null;
  const result = { deleted: [], denied: [], missing: [] };

  return new Promise((resolve, reject) => {
    const deleteWhenValidated = () => {
      if (!actorLoaded || completedRequests !== mediaRequests.length) return;
      const actor = actorRequest.result;
      if (!actor || actor.active === false) {
        domainError = new Error('La sessione non e piu autorizzata.');
        domainError.code = 'USER_UNAVAILABLE';
        transaction.abort();
        return;
      }

      for (const entry of mediaRequests) {
        const item = entry.request.result;
        if (!item) {
          result.missing.push(entry.mediaId);
          continue;
        }
        if (!canDeleteMedia(actor, item, now)) {
          result.denied.push(entry.mediaId);
          continue;
        }

        result.deleted.push(entry.mediaId);
        media.delete(entry.mediaId);
        mediaBlobs.delete(entry.mediaId);
        thumbnails.delete(entry.mediaId);
        const cursorRequest = favoriteMediaIndex.openKeyCursor(IDBKeyRange.only(entry.mediaId));
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          favorites.delete(cursor.primaryKey);
          cursor.continue();
        };
      }
    };

    actorRequest.onsuccess = () => {
      actorLoaded = true;
      deleteWhenValidated();
    };
    for (const entry of mediaRequests) {
      entry.request.onsuccess = () => {
        entry.loaded = true;
        completedRequests += 1;
        deleteWhenValidated();
      };
    }
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(
      domainError
      ?? transaction.error
      ?? new Error('Eliminazione dei media non riuscita.'),
    );
    transaction.onerror = () => {
      // The abort handler reports the final transaction error.
    };
  });
}

export async function toggleFavoriteAtomic({
  id,
  userId,
  context,
  mediaId,
  createdAt = Date.now(),
}) {
  const database = await openDatabase();
  const transaction = database.transaction(
    [STORE_NAMES.USERS, STORE_NAMES.MEDIA, STORE_NAMES.FAVORITES],
    'readwrite',
  );
  const users = transaction.objectStore(STORE_NAMES.USERS);
  const media = transaction.objectStore(STORE_NAMES.MEDIA);
  const favorites = transaction.objectStore(STORE_NAMES.FAVORITES);
  const userRequest = users.get(userId);
  const mediaRequest = media.get(mediaId);
  const favoriteRequest = favorites.get(id);
  let loaded = 0;
  let enabled = false;
  let domainError = null;

  return new Promise((resolve, reject) => {
    const toggleWhenValidated = () => {
      loaded += 1;
      if (loaded !== 3) return;
      const user = userRequest.result;
      const item = mediaRequest.result;
      if (!user || user.active === false) {
        domainError = new Error('L\'utente non e piu attivo.');
        domainError.code = 'USER_UNAVAILABLE';
        transaction.abort();
        return;
      }
      if (!item) {
        domainError = new Error('Il media non e piu disponibile.');
        domainError.code = 'MEDIA_UNAVAILABLE';
        transaction.abort();
        return;
      }

      if (favoriteRequest.result) {
        favorites.delete(id);
        enabled = false;
        return;
      }
      favorites.add({
        id,
        userId,
        mediaId,
        context,
        favorite: 1,
        siteId: item.siteId,
        mediaType: item.mediaType,
        authorId: item.authorId,
        takenAt: item.takenAt,
        createdAt,
      });
      enabled = true;
    };

    userRequest.onsuccess = toggleWhenValidated;
    mediaRequest.onsuccess = toggleWhenValidated;
    favoriteRequest.onsuccess = toggleWhenValidated;
    transaction.oncomplete = () => resolve(enabled);
    transaction.onabort = () => reject(
      domainError
      ?? transaction.error
      ?? new Error('Aggiornamento del preferito non riuscito.'),
    );
    transaction.onerror = () => {
      // The abort handler reports the final transaction error.
    };
  });
}

export async function putFavorite(record) {
  return putRecord(STORE_NAMES.FAVORITES, record);
}

export async function deleteFavorite(id) {
  return deleteRecord(STORE_NAMES.FAVORITES, id);
}

export async function getFavorite(id) {
  return getRecord(STORE_NAMES.FAVORITES, id);
}

export async function getStorageCounts() {
  const database = await openDatabase();
  const transaction = database.transaction(
    [STORE_NAMES.USERS, STORE_NAMES.SITES, STORE_NAMES.MEDIA, STORE_NAMES.FAVORITES],
    'readonly',
  );
  const completion = transactionToPromise(transaction);
  const result = await Promise.all([
    requestToPromise(transaction.objectStore(STORE_NAMES.USERS).count()),
    requestToPromise(transaction.objectStore(STORE_NAMES.SITES).count()),
    requestToPromise(transaction.objectStore(STORE_NAMES.MEDIA).count()),
    requestToPromise(transaction.objectStore(STORE_NAMES.FAVORITES).count()),
  ]);
  await completion;
  return {
    users: result[0],
    sites: result[1],
    media: result[2],
    favorites: result[3],
  };
}
