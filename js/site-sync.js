import { LIMITS, SITE_STATUSES, STORE_NAMES } from './config.js?v=1.6.0';
import {
  deleteMediaCascade,
  deleteRecord,
  getAllByIndex,
  getAllRecords,
  getMediaIdsForSite,
  getRecord,
  getSetting,
  putRecord,
  setSetting,
} from './db.js?v=1.6.0';
import { isConnectivityError } from './remote-auth.js?v=1.6.0';
import {
  createRemoteSite,
  deleteRemoteSite,
  importLocalSites,
  listRemoteSites,
  updateRemoteSite,
} from './site-api.js?v=1.6.0';
import {
  getSiteFavoriteIds,
  setSiteFavoriteIds,
  SITE_FAVORITE_CONTEXTS,
  synchronizeSiteFavorites,
} from './site-favorites.js?v=1.6.0';

const MIGRATION_KEY_PREFIX = 'central-sites-migrated::';
let syncPromise = null;

function migrationKey(userId) {
  return `${MIGRATION_KEY_PREFIX}${userId}`;
}

function remoteToLocal(remote, existing = {}) {
  const createdAt = Number(existing.createdAt) || Date.parse(remote.createdAt) || Date.now();
  const updatedAt = Date.parse(remote.updatedAt) || Date.now();
  return {
    ...existing,
    id: remote.id,
    name: remote.name,
    nameNormalized: String(remote.name || '').trim().toLocaleLowerCase('it-IT').normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
    client: remote.client || '',
    address: remote.address || '',
    status: remote.deleted ? SITE_STATUSES.DELETING : remote.status,
    folderName: remote.folderName || remote.name,
    createdAt,
    updatedAt,
    serverRevision: Number(remote.revision || 0),
    serverUpdatedAt: remote.updatedAt || '',
    centralSynced: true,
    syncState: remote.deleted ? 'remote-deleted' : 'synced',
  };
}

async function replaceFavoriteSiteId(oldId, newId) {
  const settings = await getAllRecords(STORE_NAMES.SETTINGS);
  for (const record of settings) {
    if (!record.key?.startsWith('site-favorites::') || !Array.isArray(record.value)) continue;
    if (!record.value.includes(oldId)) continue;
    const next = [...new Set(record.value.map((id) => (id === oldId ? newId : id)))];
    await setSetting(record.key, next);
  }
}

async function remapSiteId(oldId, newId) {
  if (!oldId || !newId || oldId === newId) return;
  const oldSite = await getRecord(STORE_NAMES.SITES, oldId);
  if (!oldSite) return;
  const target = await getRecord(STORE_NAMES.SITES, newId);
  await putRecord(STORE_NAMES.SITES, { ...oldSite, ...target, id: newId });

  const media = await getAllByIndex(STORE_NAMES.MEDIA, 'siteId', IDBKeyRange.only(oldId));
  for (const item of media) await putRecord(STORE_NAMES.MEDIA, { ...item, siteId: newId });

  const favorites = await getAllRecords(STORE_NAMES.FAVORITES);
  for (const favorite of favorites) {
    if (favorite.siteId === oldId) await putRecord(STORE_NAMES.FAVORITES, { ...favorite, siteId: newId });
  }

  await replaceFavoriteSiteId(oldId, newId);
  await deleteRecord(STORE_NAMES.SITES, oldId);
}

async function purgeLocalSite(siteId) {
  while (true) {
    const ids = await getMediaIdsForSite(siteId, LIMITS.SITE_DELETE_BATCH_SIZE);
    if (!ids.length) break;
    await deleteMediaCascade(ids);
  }
  await deleteRecord(STORE_NAMES.SITES, siteId);

  for (const context of Object.values(SITE_FAVORITE_CONTEXTS)) {
    const users = await getAllRecords(STORE_NAMES.USERS);
    for (const user of users) {
      const ids = await getSiteFavoriteIds(user.id, context);
      if (ids.includes(siteId)) {
        await setSiteFavoriteIds(user.id, context, ids.filter((id) => id !== siteId), { dirty: true });
      }
    }
  }
}

async function importLegacySites() {
  const localSites = (await getAllRecords(STORE_NAMES.SITES))
    .filter((site) => site.status !== SITE_STATUSES.DELETING && !site.centralSynced)
    .map((site) => ({
      id: site.id,
      name: site.name,
      client: site.client || '',
      address: site.address || '',
      status: site.status === SITE_STATUSES.COMPLETED ? SITE_STATUSES.COMPLETED : SITE_STATUSES.ACTIVE,
      folderName: site.folderName || site.name,
    }));

  if (!localSites.length) return { imported: 0, mappings: [] };
  const result = await importLocalSites(localSites);
  const remoteById = new Map((result.sites || []).map((site) => [site.id, site]));
  for (const mapping of result.mappings || []) {
    if (!mapping.remoteId || !mapping.localId) continue;
    if (mapping.remoteId !== mapping.localId) {
      await remapSiteId(mapping.localId, mapping.remoteId);
    }
    const local = await getRecord(STORE_NAMES.SITES, mapping.remoteId);
    const remote = remoteById.get(mapping.remoteId);
    if (local && remote) await putRecord(STORE_NAMES.SITES, remoteToLocal(remote, local));
  }
  return { imported: localSites.length, mappings: result.mappings || [] };
}

async function flushPendingMutations() {
  const localSites = await getAllRecords(STORE_NAMES.SITES);
  let pushed = 0;
  const conflicts = [];

  for (const site of localSites) {
    try {
      if (site.syncState === 'pending-create') {
        const remote = await createRemoteSite(site);
        await putRecord(STORE_NAMES.SITES, remoteToLocal(remote, site));
        pushed += 1;
      } else if (site.syncState === 'pending-update') {
        const remote = await updateRemoteSite(site);
        await putRecord(STORE_NAMES.SITES, remoteToLocal(remote, site));
        pushed += 1;
      } else if (site.syncState === 'pending-delete' || site.status === SITE_STATUSES.DELETING) {
        await deleteRemoteSite(site);
        await purgeLocalSite(site.id);
        pushed += 1;
      }
    } catch (error) {
      if (isConnectivityError(error)) throw error;
      if (error.code === 'SITE_REVISION_CONFLICT' && error.details?.payload?.site) {
        await putRecord(STORE_NAMES.SITES, remoteToLocal(error.details.payload.site, site));
        conflicts.push(site.id);
        continue;
      }
      throw error;
    }
  }
  return { pushed, conflicts };
}

async function reconcileRemoteSites(remoteSites) {
  let pulled = 0;
  let deleted = 0;
  for (const remote of remoteSites) {
    const local = await getRecord(STORE_NAMES.SITES, remote.id);
    if (remote.deleted) {
      if (local) {
        await purgeLocalSite(remote.id);
        deleted += 1;
      }
      continue;
    }
    const next = remoteToLocal(remote, local || {});
    if (!local || JSON.stringify(local) !== JSON.stringify(next)) pulled += 1;
    await putRecord(STORE_NAMES.SITES, next);
  }
  return { pulled, deleted };
}

async function syncFavorites(userId, firstMigration) {
  const result = {};
  for (const context of Object.values(SITE_FAVORITE_CONTEXTS)) {
    result[context] = await synchronizeSiteFavorites(userId, context, { firstMigration });
  }
  return result;
}

async function runSync(user) {
  if (!user?.id || !navigator.onLine) return { online: false, changed: false };
  const firstMigration = !(await getSetting(migrationKey(user.id), false));
  const imported = await importLegacySites();
  const pending = await flushPendingMutations();
  const remoteSites = await listRemoteSites();
  const reconciled = await reconcileRemoteSites(remoteSites);
  await syncFavorites(user.id, firstMigration);
  await setSetting(migrationKey(user.id), true);

  const changed = imported.imported > 0 || pending.pushed > 0 || reconciled.pulled > 0 || reconciled.deleted > 0;
  return {
    online: true,
    changed,
    imported: imported.imported,
    pushed: pending.pushed,
    pulled: reconciled.pulled,
    deleted: reconciled.deleted,
    conflicts: pending.conflicts,
  };
}

export async function synchronizeSites(user) {
  if (syncPromise) return syncPromise;
  syncPromise = runSync(user).finally(() => { syncPromise = null; });
  return syncPromise;
}

export async function applyRemoteSite(remote, existing = {}) {
  const local = remoteToLocal(remote, existing);
  await putRecord(STORE_NAMES.SITES, local);
  return local;
}
