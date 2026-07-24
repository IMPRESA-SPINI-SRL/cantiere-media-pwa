import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('l archivio aziendale scarica modifiche incrementali e conserva i metadati locali', async () => {
  const [sync, database, api] = await Promise.all([
    readFile(resolve(root, 'js/central-media-sync.js'), 'utf8'),
    readFile(resolve(root, 'js/db.js'), 'utf8'),
    readFile(resolve(root, 'js/media-api.js'), 'utf8'),
  ]);
  assert.match(api, /\/api\/media\/changes/);
  assert.match(sync, /checkpoint/);
  assert.match(sync, /upsertRemoteMediaBatch/);
  assert.match(sync, /removeRemoteMediaBatch/);
  assert.match(database, /centralOnly/);
  assert.match(database, /centralSynced/);
});

test('viewer e miniature possono usare file presenti solo nell archivio centrale', async () => {
  const [media, viewer, index] = await Promise.all([
    readFile(resolve(root, 'js/media.js'), 'utf8'),
    readFile(resolve(root, 'js/viewer.js'), 'utf8'),
    readFile(resolve(root, 'index.html'), 'utf8'),
  ]);
  assert.match(media, /getRemoteMediaAccess/);
  assert.match(media, /getRemoteMediaThumbnail/);
  assert.match(media, /getMediaPlaybackSource/);
  assert.match(viewer, /getMediaPlaybackSource\(media\)/);
  assert.match(index, /img-src 'self' blob: data: https:\/\/\*\.1drv\.com/);
  assert.match(index, /media-src 'self' blob: https:\/\/\*\.1drv\.com/);
});

test('l eliminazione centrale rimuove OneDrive e non promette di conservare il file', async () => {
  const [media, app, api] = await Promise.all([
    readFile(resolve(root, 'js/media.js'), 'utf8'),
    readFile(resolve(root, 'js/app.js'), 'utf8'),
    readFile(resolve(root, 'js/media-api.js'), 'utf8'),
  ]);
  assert.match(api, /\/api\/media\/delete/);
  assert.match(media, /deleteRemoteMedia\(media\)/);
  assert.match(app, /rimossi anche da OneDrive e dagli altri dispositivi/);
  assert.doesNotMatch(app, /resteranno nell'archivio OneDrive aziendale/);
});


test('le miniature centrali passano dal proxy autenticato del backend', async () => {
  const [media, api, auth] = await Promise.all([
    readFile(resolve(root, 'js/media.js'), 'utf8'),
    readFile(resolve(root, 'js/media-api.js'), 'utf8'),
    readFile(resolve(root, 'js/remote-auth.js'), 'utf8'),
  ]);
  assert.match(api, /\/api\/media\/thumbnail/);
  assert.match(api, /centralApiBlobRequest/);
  assert.match(auth, /export async function centralApiBlobRequest/);
  assert.match(media, /getRemoteMediaThumbnail/);
});
