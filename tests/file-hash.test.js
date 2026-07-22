import test from 'node:test';
import assert from 'node:assert/strict';
import { bytesToHex, sha256Blob } from '../js/file-hash.js';

test('bytesToHex produce una stringa esadecimale stabile', () => {
  assert.equal(bytesToHex(new Uint8Array([0, 15, 16, 255])), '000f10ff');
});

test('SHA-256 riconosce contenuti identici anche con nomi indipendenti', async () => {
  const first = new Blob(['contenuto-media-identico'], { type: 'image/jpeg' });
  const second = new Blob(['contenuto-media-identico'], { type: 'image/jpeg' });
  const different = new Blob(['contenuto-media-diverso'], { type: 'image/jpeg' });

  assert.equal(await sha256Blob(first), await sha256Blob(second));
  assert.notEqual(await sha256Blob(first), await sha256Blob(different));
});
