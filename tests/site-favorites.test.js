import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SITE_STATUSES } from '../js/config.js';
import { SitePickerController, wheelDeltaPixels } from '../js/site-picker.js';
import {
  groupSitesForPicker,
  SITE_FAVORITE_CONTEXTS,
  sortSitesByFavorites,
} from '../js/site-favorites.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const sites = [
  { id: 'z-active', name: 'Zeta', status: SITE_STATUSES.ACTIVE },
  { id: 'a-completed', name: 'Alfa', status: SITE_STATUSES.COMPLETED },
  { id: 'm-active', name: 'Muro', status: SITE_STATUSES.ACTIVE },
  { id: 'b-completed', name: 'Beta', status: SITE_STATUSES.COMPLETED },
  { id: 'c-active', name: 'Casa 2', status: SITE_STATUSES.ACTIVE },
  { id: 'c10-active', name: 'Casa 10', status: SITE_STATUSES.ACTIVE },
];

test('ordine richiesto: preferiti alfabetici, attivi alfabetici, conclusi alfabetici', () => {
  const sorted = sortSitesByFavorites(sites, new Set(['z-active', 'a-completed']));
  assert.deepEqual(sorted.map((site) => site.id), [
    'a-completed',
    'z-active',
    'c-active',
    'c10-active',
    'm-active',
    'b-completed',
  ]);
});

test('i preferiti attivi e conclusi sono mescolati in un unico gruppo alfabetico', () => {
  const groups = groupSitesForPicker(sites, new Set(['z-active', 'a-completed', 'b-completed']));
  assert.deepEqual(groups.favorites.map((site) => site.name), ['Alfa', 'Beta', 'Zeta']);
  assert.deepEqual(groups.active.map((site) => site.name), ['Casa 2', 'Casa 10', 'Muro']);
  assert.deepEqual(groups.completed, []);
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

test('il selettore mostra stelle e gruppi separati', async () => {
  const source = await readFile(resolve(root, 'js/site-picker.js'), 'utf8');
  assert.match(source, /site-picker-star/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /Preferiti/);
  assert.match(source, /Cantieri attivi/);
  assert.match(source, /Cantieri conclusi/);
  assert.match(source, /Tutti i cantieri/);
});


test('la rotellina scorre direttamente l elenco cantieri', () => {
  const list = {
    scrollHeight: 1000,
    clientHeight: 400,
    scrollTop: 120,
  };
  let prevented = false;
  let stopped = false;
  SitePickerController.prototype.handleWheel.call({ list }, {
    deltaY: 3,
    deltaMode: 1,
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; },
  });

  assert.equal(wheelDeltaPixels(3, 1, 400), 54);
  assert.equal(list.scrollTop, 174);
  assert.equal(prevented, true);
  assert.equal(stopped, true);
});

test('su PC il selettore e centrato e la lista ha scorrimento verticale dedicato', async () => {
  const style = await readFile(resolve(root, 'css/style.css'), 'utf8');
  assert.match(style, /@media \(min-width: 600px\)[\s\S]*?\.site-picker-dialog \{[\s\S]*?margin: auto;/);
  assert.match(style, /\.site-picker-list \{[\s\S]*?overflow-y: auto;/);
  assert.match(style, /scrollbar-gutter: stable/);
});
