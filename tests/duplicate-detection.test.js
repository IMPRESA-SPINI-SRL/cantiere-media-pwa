import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('IndexedDB limita l impronta unica al singolo cantiere', async () => {
  const source = await readFile(resolve(root, 'js/db.js'), 'utf8');
  assert.match(source, /deleteIndex\('contentHash'\)/);
  assert.match(source, /deleteIndex\('typeSize'\)/);
  assert.match(source, /ensureIndex\(media, 'siteContentHash', \['siteId', 'contentHash'\], \{ unique: true \}\)/);
  assert.match(source, /ensureIndex\(media, 'siteTypeSize', \['siteId', 'mediaType', 'size'\]\)/);
  assert.match(source, /getMediaBySiteAndContentHash/);
  assert.match(source, /getMediaCandidatesBySiteTypeAndSize/);
  assert.doesNotMatch(source, /ensureIndex\(media, 'contentHash', 'contentHash'/);
});

test('il controllo duplicati riceve sempre il cantiere selezionato', async () => {
  const media = await readFile(resolve(root, 'js/media.js'), 'utf8');
  assert.match(media, /findExactDuplicate\(file, siteId, mediaType/);
  assert.match(media, /getMediaBySiteAndContentHash\(siteId, hash\)/);
  assert.match(media, /getMediaCandidatesBySiteTypeAndSize\(\s*siteId,/);
  assert.match(media, /findExactDuplicate\(file, storedSite\.id, mediaType\)/);
  assert.match(media, /file gia presente nel cantiere selezionato/);
});

test('upload classifica i duplicati come ignorati e non come errori generici', async () => {
  const [media, upload] = await Promise.all([
    readFile(resolve(root, 'js/media.js'), 'utf8'),
    readFile(resolve(root, 'js/upload.js'), 'utf8'),
  ]);
  assert.match(media, /contentHash: duplicateResult\.contentHash/);
  assert.match(media, /'DUPLICATE_MEDIA'/);
  assert.match(upload, /duplicati ignorati/);
  assert.match(upload, /error\?\.code === 'DUPLICATE_MEDIA'/);
});
