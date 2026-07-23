import test from 'node:test';
import assert from 'node:assert/strict';
import { PIN_PATTERN, isSessionExpired } from '../js/remote-auth.js';

test('il PIN centralizzato richiede esattamente 6 cifre', () => {
  assert.equal(PIN_PATTERN.test('123456'), true);
  assert.equal(PIN_PATTERN.test('12345'), false);
  assert.equal(PIN_PATTERN.test('1234567'), false);
  assert.equal(PIN_PATTERN.test('12345a'), false);
});

test('una sessione centrale scaduta non viene ripristinata offline', () => {
  assert.equal(isSessionExpired({ expiresAt: '2099-01-01T00:00:00.000Z' }, 0), false);
  assert.equal(isSessionExpired({ expiresAt: '2020-01-01T00:00:00.000Z' }, Date.now()), true);
  assert.equal(isSessionExpired(null, Date.now()), true);
});
