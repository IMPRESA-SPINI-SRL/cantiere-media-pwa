import { LIMITS, ROLES } from './config.js?v=1.0.3';

export function isAdministrator(user) {
  return user?.role === ROLES.ADMIN && user?.active !== false;
}

export function canManageSites(user) {
  return isAdministrator(user);
}

export function canManageUsers(user) {
  return isAdministrator(user);
}

export function canDeleteMedia(user, media, now = Date.now()) {
  if (!user || !media) return false;
  if (user.active === false) return false;
  if (isAdministrator(user)) return true;
  if (media.authorId !== user.id) return false;
  const age = now - Number(media.uploadDate);
  return Number.isFinite(age) && age >= 0 && age <= LIMITS.DELETE_WINDOW_MS;
}

export function splitMediaByDeletionPermission(user, items, now = Date.now()) {
  const allowed = [];
  const denied = [];
  for (const item of items) {
    (canDeleteMedia(user, item, now) ? allowed : denied).push(item);
  }
  return { allowed, denied };
}
