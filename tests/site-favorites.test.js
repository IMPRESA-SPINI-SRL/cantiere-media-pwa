import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SITE_FAVORITE_CONTEXTS,
  sortSitesByFavorites,
} from '../js/site-favorites.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('i cantieri preferiti sono ordinati prima degli altri senza perdere l ordine originale', () => {
  const sites = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
    { id: 'd', name: 'D' },
  ];
  const sorted = sortSitesByFavorites(sites, new Set(['c', 'a']));
  assert.deepEqual(sorted.map((site) => site.id), ['a', 'c', 'b', 'd']);
});

test('archivio e caricamento usano contesti preferiti indipendenti', () => {
  assert.equal(SITE_FAVORITE_CONTEXTS.ARCHIVE, 'archive');
  assert.equal(SITE_FAVORITE_CONTEXTS.UPLOAD, 'upload');
  assert.notEqual(SITE_FAVORITE_CONTEXTS.ARCHIVE, SITE_FAVORITE_CONTEXTS.UPLOAD);
});

test('la chiave persistente include sia utente sia contesto', async () => {
  const source = await readFile(resolve(root, 'js/site-favorites.js'), 'utf8');
  assert.match(source, /site-favorites::\$\{userId\}::\$\{context\}/);
});

test('il selettore mostra una stella per ogni cantiere', async () => {
  const source = await readFile(resolve(root, 'js/site-picker.js'), 'utf8');
  assert.match(source, /site-picker-star/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /Preferiti/);
  assert.match(source, /Altri cantieri/);
});
