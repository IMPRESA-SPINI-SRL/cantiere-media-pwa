import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { shouldPushSiteFavorites } from '../js/site-favorites.js';

test('la prima apertura di un nuovo dispositivo non cancella preferiti centrali con una lista locale vuota', () => {
  assert.equal(shouldPushSiteFavorites({ firstMigration: true, dirty: false, localIds: [] }), false);
  assert.equal(shouldPushSiteFavorites({ firstMigration: true, dirty: false, localIds: ['site-1'] }), true);
  assert.equal(shouldPushSiteFavorites({ firstMigration: false, dirty: true, localIds: [] }), true);
});

test('la release collega sincronizzazione cantieri, API centrale e versione nella schermata login', async () => {
  const [app, worker, index, siteSync, database] = await Promise.all([
    readFile(new URL('../js/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../service-worker.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../js/site-sync.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/db.js', import.meta.url), 'utf8'),
  ]);
  assert.match(app, /synchronizeSites\(currentUser\)/);
  assert.match(worker, /site-api\.js\?v=1\.7\.0/);
  assert.match(worker, /site-sync\.js\?v=1\.7\.0/);
  assert.match(index, /id="auth-version-label"/);
  assert.match(siteSync, /importLegacySites/);
  assert.match(siteSync, /pending-delete/);
  assert.match(siteSync, /remapSiteIdAtomic/);
  assert.match(database, /sites\.delete\(oldId\);[\s\S]*sites\.put\(\{ \.\.\.oldSite, \.\.\.targetSite, id: newId \}\);/);
});
