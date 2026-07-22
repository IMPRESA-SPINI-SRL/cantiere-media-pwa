import { getSetting, setSetting } from './db.js?v=1.3.0';
import { SITE_STATUSES } from './config.js?v=1.3.0';

export const SITE_FAVORITE_CONTEXTS = Object.freeze({
  ARCHIVE: 'archive',
  UPLOAD: 'upload',
});

function validateContext(context) {
  if (!Object.values(SITE_FAVORITE_CONTEXTS).includes(context)) {
    throw new Error('Contesto preferiti cantieri non valido.');
  }
}

function settingKey(userId, context) {
  validateContext(context);
  if (!userId) throw new Error('Utente non valido.');
  return `site-favorites::${userId}::${context}`;
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
  return normalizeIds(await getSetting(settingKey(userId, context), []));
}

export async function toggleSiteFavorite(userId, context, siteId) {
  if (!siteId) throw new Error('Cantiere non valido.');
  const key = settingKey(userId, context);
  const ids = new Set(normalizeIds(await getSetting(key, [])));
  const favorite = !ids.has(siteId);
  if (favorite) ids.add(siteId);
  else ids.delete(siteId);
  const value = [...ids];
  await setSetting(key, value);
  return { favorite, ids: value };
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
