import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('the first operational view gives direct priority to uploads', async () => {
  const [index, app, config] = await Promise.all([
    readFile(resolve(root, 'index.html'), 'utf8'),
    readFile(resolve(root, 'js/app.js'), 'utf8'),
    readFile(resolve(root, 'js/config.js'), 'utf8'),
  ]);
  assert.match(index, /id="upload-home"/);
  assert.match(index, /id="upload-site-select"/);
  assert.match(index, /id="home-photo-action"/);
  assert.match(index, /id="home-video-action"/);
  assert.match(index, /id="home-gallery-action"/);
  assert.doesNotMatch(index, /id="upload-fab"/);
  assert.match(config, /UPLOAD: 'upload'/);
  assert.match(app, /setView\(VIEW_MODES\.UPLOAD, \{ closeMenu: false \}\)/);
  assert.match(app, /startPhotoCapture/);
  assert.match(app, /startVideoCapture/);
  assert.match(app, /startGalleryImport/);
});

test('the archive exposes date grouping and a pinch hint', async () => {
  const [index, gallery] = await Promise.all([
    readFile(resolve(root, 'index.html'), 'utf8'),
    readFile(resolve(root, 'js/gallery.js'), 'utf8'),
  ]);
  assert.match(index, /id="gallery-gesture-hint"/);
  assert.match(index, /id="gallery-zoom-indicator"/);
  assert.match(gallery, /buildGalleryLayoutRows/);
  assert.match(gallery, /gesturechange/);
  assert.match(gallery, /calculatePinchColumns/);
});


test('le sezioni media personali sono rimosse e la schermata di caricamento non contiene istruzioni ridondanti', async () => {
  const index = await readFile(resolve(root, 'index.html'), 'utf8');
  for (const removedText of [
    'I miei upload',
    'Preferiti archivio',
    'Preferiti upload',
    'OPERAZIONE PRINCIPALE',
    'Seleziona il cantiere e scegli subito come acquisire il materiale.',
    'Destinazione: Scegli una delle tre modalità qui sopra',
  ]) {
    assert.doesNotMatch(index, new RegExp(removedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
});

test('logo e selettori cantieri preferiti sono presenti nelle due viste', async () => {
  const index = await readFile(resolve(root, 'index.html'), 'utf8');
  assert.match(index, /images\/logo-spini\.png/);
  assert.match(index, /id="upload-site-picker-trigger"/);
  assert.match(index, /id="archive-site-picker-trigger"/);
  assert.match(index, /id="site-picker-dialog"/);
});
