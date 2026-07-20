import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = '1.0.3';
const escapedVersion = version.replaceAll('.', '\\.');

test('gli asset principali e i moduli runtime sono versionati', async () => {
  const index = await readFile(resolve(root, 'index.html'), 'utf8');
  assert.match(index, new RegExp(`css/style\\.css\\?v=${escapedVersion}`));
  assert.match(index, new RegExp(`js/bootstrap-${escapedVersion}\\.js`));

  const bootstrap = await readFile(resolve(root, `js/bootstrap-${version}.js`), 'utf8');
  assert.match(bootstrap, /import\(`\.\/app\.js\?v=\$\{APP_VERSION\}`\)/);

  const names = (await readdir(resolve(root, 'js')))
    .filter((name) => name.endsWith('.js') && !name.startsWith('bootstrap-'));
  for (const name of names) {
    const source = await readFile(resolve(root, 'js', name), 'utf8');
    const imports = [...source.matchAll(/from\s+['"](\.\/[^'"]+\.js(?:\?[^'"]*)?)['"]/g)];
    for (const [, specifier] of imports) {
      assert.match(specifier, new RegExp(`\\?v=${escapedVersion}$`), `${name}: ${specifier}`);
    }
  }
});

test('il bootstrap rileva una cache o un Service Worker di versione precedente', async () => {
  const source = await readFile(resolve(root, `js/bootstrap-${version}.js`), 'utf8');
  assert.match(source, /name\.startsWith\(CACHE_PREFIX\) && name !== CURRENT_CACHE/);
  assert.match(source, /searchParams\.get\('v'\) !== APP_VERSION/);
  assert.match(source, /location\.replace\(`\.\/repair\.html/);
});

test('il Service Worker forza asset freschi per la nuova release', async () => {
  const source = await readFile(resolve(root, 'service-worker.js'), 'utf8');
  assert.match(source, /new Request\(url, \{ cache: 'reload' \}\)/);
  assert.match(source, /\.\/js\/bootstrap-1\.0\.3\.js/);
  assert.match(source, /\.\/js\/viewer\.js\?v=1\.0\.3/);
  assert.match(source, /cantiere-media-shell-\$\{APP_VERSION\}/);
});

test('repair.html rimuove solo worker e cache senza cancellare IndexedDB', async () => {
  const source = await readFile(resolve(root, 'repair.html'), 'utf8');
  assert.match(source, /serviceWorker\.getRegistrations\(\)/);
  assert.match(source, /registration\.unregister\(\)/);
  assert.match(source, /caches\.keys\(\)/);
  assert.match(source, /startsWith\('cantiere-media-shell-'\)/);
  assert.doesNotMatch(source, /indexedDB\.deleteDatabase|localStorage\.clear|sessionStorage\.clear/);
});
