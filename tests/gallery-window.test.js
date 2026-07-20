import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGalleryWindow } from '../js/gallery.js';

test('small galleries render every item without virtual spacers', () => {
  assert.deepEqual(computeGalleryWindow({
    itemCount: 120,
    columns: 3,
    visibleStartRow: 20,
    visibleRows: 10,
  }), {
    startIndex: 0,
    endIndex: 120,
    startRow: 0,
    endRow: 40,
    totalRows: 40,
  });
});

test('large galleries keep a bounded window around the viewport', () => {
  const window = computeGalleryWindow({
    itemCount: 50000,
    columns: 3,
    visibleStartRow: 4000,
    visibleRows: 12,
  });
  assert.ok(window.startIndex > 0);
  assert.ok(window.endIndex < 50000);
  assert.ok(window.startRow <= 4000);
  assert.ok(window.endRow >= 4012);
  assert.ok(window.endIndex - window.startIndex <= 3 * 90);
});

test('the virtual window reaches the final partial row', () => {
  const window = computeGalleryWindow({
    itemCount: 1000,
    columns: 4,
    visibleStartRow: 246,
    visibleRows: 8,
  });
  assert.equal(window.endIndex, 1000);
  assert.equal(window.totalRows, 250);
});
