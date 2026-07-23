import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeChunkRange,
  normalizeChunkSize,
  parseNextExpectedOffset,
} from '../js/media-sync.js?v=1.7.0';

test('normalizza i frammenti a multipli di 320 KiB', () => {
  assert.equal(normalizeChunkSize(5 * 1024 * 1024), 5 * 1024 * 1024);
  assert.equal(normalizeChunkSize(5 * 1024 * 1024 + 123), 5 * 1024 * 1024);
  assert.equal(normalizeChunkSize(1), 320 * 1024);
});

test('legge il primo offset richiesto dalla sessione OneDrive', () => {
  assert.equal(parseNextExpectedOffset(['0-']), 0);
  assert.equal(parseNextExpectedOffset(['5242880-']), 5242880);
  assert.equal(parseNextExpectedOffset([], 100), 100);
});

test('calcola l ultimo frammento senza superare la dimensione del file', () => {
  const range = computeChunkRange(5 * 1024 * 1024, 6 * 1024 * 1024, 5 * 1024 * 1024);
  assert.equal(range.start, 5 * 1024 * 1024);
  assert.equal(range.endExclusive, 6 * 1024 * 1024);
  assert.equal(range.length, 1024 * 1024);
});
