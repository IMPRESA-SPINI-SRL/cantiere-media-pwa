import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionMediaByType } from '../js/media.js?v=1.5.0';

test('la selezione mista viene separata in foto e video', () => {
  const items = [
    { id: 'p1', mediaType: 'photo' },
    { id: 'v1', mediaType: 'video' },
    { id: 'p2', mediaType: 'photo' },
  ];
  const result = partitionMediaByType(items);
  assert.deepEqual(result.photos.map((item) => item.id), ['p1', 'p2']);
  assert.deepEqual(result.videos.map((item) => item.id), ['v1']);
});

test('i tipi sconosciuti non vengono condivisi accidentalmente', () => {
  const result = partitionMediaByType([
    { id: 'x1', mediaType: 'document' },
    null,
  ]);
  assert.deepEqual(result, { photos: [], videos: [] });
});
