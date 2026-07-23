import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPinCredentials,
  isRestorableSession,
  toPublicUser,
  validatePin,
  verifyPin,
} from '../js/auth.js';

test('PIN validation accepts exactly 6 decimal digits', () => {
  assert.equal(validatePin('123456'), true);
  assert.equal(validatePin('12345'), false);
  assert.equal(validatePin('1234567'), false);
  assert.equal(validatePin('12a456'), false);
});

test('PBKDF2 credentials verify the correct PIN without storing it', async () => {
  const credentials = await createPinCredentials('246810');
  assert.equal(await verifyPin('246810', credentials), true);
  assert.equal(await verifyPin('246811', credentials), false);
  assert.equal(JSON.stringify(credentials).includes('246810'), false);
});

test('public user snapshots do not expose PIN derivation fields', () => {
  const publicUser = toPublicUser({
    id: 'user-1',
    name: 'Operatore',
    pinSalt: 'salt',
    pinHash: 'hash',
    pinIterations: 100,
    pinVersion: 1,
  });
  assert.deepEqual(publicUser, { id: 'user-1', name: 'Operatore' });
});


test('la sessione persistente viene ripristinata solo per un utente attivo corrispondente', () => {
  const session = { userId: 'user-1', authenticatedAt: Date.now() };
  assert.equal(isRestorableSession(session, { id: 'user-1', active: true }), true);
  assert.equal(isRestorableSession(session, { id: 'user-1', active: false }), false);
  assert.equal(isRestorableSession(session, { id: 'user-2', active: true }), false);
  assert.equal(isRestorableSession(null, { id: 'user-1', active: true }), false);
});
