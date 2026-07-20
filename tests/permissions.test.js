import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, ROLES } from '../js/config.js';
import { canDeleteMedia, splitMediaByDeletionPermission } from '../js/permissions.js';

const now = Date.now();
const user = { id: 'user-1', role: ROLES.USER, active: true };
const admin = { id: 'admin-1', role: ROLES.ADMIN, active: true };

test('an administrator can delete every media', () => {
  assert.equal(canDeleteMedia(admin, {
    authorId: 'another-user',
    uploadDate: now - 10 * LIMITS.DELETE_WINDOW_MS,
  }, now), true);
});

test('a normal user can delete only own uploads within 24 hours', () => {
  assert.equal(canDeleteMedia(user, {
    authorId: user.id,
    uploadDate: now - LIMITS.DELETE_WINDOW_MS + 1,
  }, now), true);
  assert.equal(canDeleteMedia(user, {
    authorId: user.id,
    uploadDate: now - LIMITS.DELETE_WINDOW_MS - 1,
  }, now), false);
  assert.equal(canDeleteMedia(user, {
    authorId: 'user-2',
    uploadDate: now,
  }, now), false);
  assert.equal(canDeleteMedia(user, {
    authorId: user.id,
    uploadDate: now + 1000,
  }, now), false);
});

test('an inactive user cannot delete media even with a matching role or author', () => {
  assert.equal(canDeleteMedia({ ...admin, active: false }, {
    authorId: 'another-user',
    uploadDate: now,
  }, now), false);
  assert.equal(canDeleteMedia({ ...user, active: false }, {
    authorId: user.id,
    uploadDate: now,
  }, now), false);
});

test('selection splitting preserves allowed and denied items', () => {
  const items = [
    { id: 'a', authorId: user.id, uploadDate: now },
    { id: 'b', authorId: 'user-2', uploadDate: now },
  ];
  const result = splitMediaByDeletionPermission(user, items, now);
  assert.deepEqual(result.allowed.map((item) => item.id), ['a']);
  assert.deepEqual(result.denied.map((item) => item.id), ['b']);
});
