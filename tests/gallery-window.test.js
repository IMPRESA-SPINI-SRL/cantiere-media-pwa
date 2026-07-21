import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGalleryLayoutRows,
  calculatePinchColumns,
  computeGalleryWindow,
  computeVirtualRowRange,
  formatGalleryDateLabel,
  galleryDateKey,
} from '../js/gallery.js';

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

test('large galleries keep a bounded legacy window around the viewport', () => {
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
});

test('gallery layout inserts date rows and respects the selected density', () => {
  const dayOne = new Date(2026, 6, 21, 15, 0).getTime();
  const dayTwo = new Date(2026, 6, 20, 9, 0).getTime();
  const items = [
    { id: 'a', takenAt: dayOne },
    { id: 'b', takenAt: dayOne - 1000 },
    { id: 'c', takenAt: dayOne - 2000 },
    { id: 'd', takenAt: dayTwo },
  ];
  const rows = buildGalleryLayoutRows(items, 2, dayOne);
  assert.deepEqual(rows.map((row) => row.type), ['date', 'media', 'media', 'date', 'media']);
  assert.equal(rows[0].label, 'Oggi');
  assert.equal(rows[0].count, 3);
  assert.deepEqual(rows[1].indexes, [0, 1]);
  assert.deepEqual(rows[2].indexes, [2]);
  assert.equal(rows[3].label, 'Ieri');
});

test('date keys use local calendar dates rather than upload order', () => {
  const timestamp = new Date(2026, 0, 5, 23, 59).getTime();
  assert.equal(galleryDateKey(timestamp), '2026-01-05');
  assert.match(formatGalleryDateLabel(timestamp, new Date(2026, 0, 8, 12).getTime()), /5 gennaio/i);
});

test('two-finger pinch changes the number of gallery columns in Samsung style', () => {
  assert.equal(calculatePinchColumns(3, 100, 150), 2, 'spreading fingers enlarges thumbnails');
  assert.ok(calculatePinchColumns(3, 100, 65) > 3, 'pinching inward shows more columns');
  assert.equal(calculatePinchColumns(2, 100, 500), 2, 'minimum density is enforced');
  assert.equal(calculatePinchColumns(6, 100, 10), 6, 'maximum density is enforced');
});

test('virtual date-row range remains bounded for long archives', () => {
  const offsets = [0];
  for (let index = 0; index < 20000; index += 1) offsets.push(offsets.at(-1) + 110);
  const range = computeVirtualRowRange(offsets, 500000, 900, 1100);
  assert.ok(range.startRow > 0);
  assert.ok(range.endRow < 20000);
  assert.ok(range.endRow - range.startRow < 40);
});
