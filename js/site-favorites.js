import { getSetting, setSetting } from './db.js?v=1.6.0';
import { SITE_STATUSES } from './config.js?v=1.6.0';
import { isConnectivityError } from './remote-auth.js?v=1.6.0';
import { getRemoteSiteFavorites, putRemoteSiteFavorites } from './site-api.js?v=1.6.0';

export const SITE_FAVORITE_CONTEXTS = Object.freeze({
  ARCHIVE: 'archive',
  UPLOAD: 'upload',
});

function validateContext(context) {
  if (!Object.values(SITE_FAVORITE_CONTEXTS).includes(context)) {
    throw new Error('Contesto preferiti cantieri non valido.');
  }
}

export function siteFavoritesSettingKey(userId, context) {
  validateContext(context);
  if (!userId) throw new Error('Utente non valido.');
  return `site-favorites::${userId}::${context}`;
}

export function siteFavoritesDirtyKey(userId, context) {
  return `${siteFavoritesSettingKey(userId, context)}::dirty`;
}

function normalizeIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id) => typeof id === 'string' && id))];
}

function compareSiteNames(left, right) {
  return String(left?.name ?? '').localeCompare(String(right?.name ?? ''), 'it-IT', {
    sensitivity: 'base',
    numeric: true,
  });
}

export async function getSiteFavoriteIds(userId, context) {
  return normalizeIds(await getSetting(siteFavoritesSettingKey(userId, context), []));
}

export async function setSiteFavoriteIds(userId, context, ids, { dirty = false } = {}) {
  const value = normalizeIds(ids);
  await setSetting(siteFavoritesSettingKey(userId, context), value);
  await setSetting(siteFavoritesDirtyKey(userId, context), Boolean(dirty));
  return value;
}

export function shouldPushSiteFavorites({ firstMigration = false, dirty = false, localIds = [] } = {}) {
  return Boolean(dirty || (firstMigration && Array.isArray(localIds) && localIds.length > 0));
}

export async function synchronizeSiteFavorites(userId, context, { firstMigration = false } = {}) {
  const localIds = await getSiteFavoriteIds(userId, context);
  const dirty = Boolean(await getSetting(siteFavoritesDirtyKey(userId, context), false));

  if (shouldPushSiteFavorites({ firstMigration, dirty, localIds })) {
    const saved = await putRemoteSiteFavorites(context, localIds);
    return setSiteFavoriteIds(userId, context, saved, { dirty: false });
  }

  const remoteIds = await getRemoteSiteFavorites(context);
  return setSiteFavoriteIds(userId, context, remoteIds, { dirty: false });
}

export async function toggleSiteFavorite(userId, context, siteId) {
  if (!siteId) throw new Error('Cantiere non valido.');
  const key = siteFavoritesSettingKey(userId, context);
  const previous = normalizeIds(await getSetting(key, []));
  const ids = new Set(previous);
  const favorite = !ids.has(siteId);
  if (favorite) ids.add(siteId);
  else ids.delete(siteId);
  const value = [...ids];

  await setSiteFavoriteIds(userId, context, value, { dirty: true });

  if (navigator.onLine) {
    try {
      const saved = await putRemoteSiteFavorites(context, value);
      await setSiteFavoriteIds(userId, context, saved, { dirty: false });
      return { favorite: saved.includes(siteId), ids: saved, synced: true };
    } catch (error) {
      if (!isConnectivityError(error)) {
        await setSiteFavoriteIds(userId, context, previous, { dirty: false });
        throw error;
      }
    }
  }

  return { favorite, ids: value, synced: false };
}

export function groupSitesForPicker(sites, favoriteIds) {
  const favorites = favoriteIds instanceof Set ? favoriteIds : new Set(favoriteIds ?? []);
  const groups = {
    favorites: [],
    active: [],
    completed: [],
  };

  for (const site of sites ?? []) {
    if (favorites.has(site.id)) groups.favorites.push(site);
    else if (site.status === SITE_STATUSES.COMPLETED) groups.completed.push(site);
    else groups.active.push(site);
  }

  groups.favorites.sort(compareSiteNames);
  groups.active.sort(compareSiteNames);
  groups.completed.sort(compareSiteNames);
  return groups;
}

export function sortSitesByFavorites(sites, favoriteIds) {
  const groups = groupSitesForPicker(sites, favoriteIds);
  return [...groups.favorites, ...groups.active, ...groups.completed];
}
