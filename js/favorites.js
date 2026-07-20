import { FAVORITE_CONTEXTS, VIEW_MODES } from './config.js?v=1.0.3';
import {
  getFavorite,
  queryFavoritePage,
  toggleFavoriteAtomic,
} from './db.js?v=1.0.3';

export function favoriteContextForView(viewMode) {
  return [VIEW_MODES.MY_UPLOADS, VIEW_MODES.FAVORITE_UPLOADS].includes(viewMode)
    ? FAVORITE_CONTEXTS.UPLOAD
    : FAVORITE_CONTEXTS.ARCHIVE;
}

export function favoriteId(userId, context, mediaId) {
  return `${userId}::${context}::${mediaId}`;
}

export async function isFavorite(userId, context, mediaId) {
  return Boolean(await getFavorite(favoriteId(userId, context, mediaId)));
}

export async function toggleFavorite(user, media, context) {
  if (!user || !media) throw new Error('Preferito non valido.');
  if (!Object.values(FAVORITE_CONTEXTS).includes(context)) {
    throw new Error('Contesto preferiti non valido.');
  }
  const id = favoriteId(user.id, context, media.id);
  return toggleFavoriteAtomic({
    id,
    userId: user.id,
    mediaId: media.id,
    context,
    createdAt: Date.now(),
  });
}

export async function queryFavorites(filters, cursorKey, limit) {
  return queryFavoritePage(filters, cursorKey, limit);
}
