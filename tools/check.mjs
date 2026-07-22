import { spawnSync } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function collectJavaScript(directory) {
  const result = [];
  for (const name of await readdir(directory)) {
    if (name === 'node_modules') continue;
    const path = resolve(directory, name);
    const information = await stat(path);
    if (information.isDirectory()) result.push(...await collectJavaScript(path));
    else if (name.endsWith('.js') || name.endsWith('.mjs')) result.push(path);
  }
  return result;
}

async function assertPath(path, label = relative(root, path)) {
  try {
    await stat(path);
  } catch {
    throw new Error(`File mancante: ${label}`);
  }
}

function relativeImports(source) {
  const imports = [];
  const pattern = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) imports.push(match[1]);
  return imports;
}

function readPngSize(buffer) {
  const signature = '89504e470d0a1a0a';
  if (buffer.subarray(0, 8).toString('hex') !== signature || buffer.length < 24) {
    throw new Error('PNG non valido.');
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

const files = await collectJavaScript(root);
for (const file of files) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (check.status !== 0) {
    console.error(check.stderr || check.stdout);
    process.exit(check.status || 1);
  }

  const source = await readFile(file, 'utf8');
  for (const specifier of relativeImports(source)) {
    const importedPath = resolve(dirname(file), specifier.split(/[?#]/, 1)[0]);
    await assertPath(importedPath, `${relative(root, file)} -> ${specifier}`);
  }
}

const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const configSource = await readFile(resolve(root, 'js/config.js'), 'utf8');
const appSource = await readFile(resolve(root, 'js/app.js'), 'utf8');
const databaseSource = await readFile(resolve(root, 'js/db.js'), 'utf8');
const authSource = await readFile(resolve(root, 'js/auth.js'), 'utf8');
const uploadSource = await readFile(resolve(root, 'js/upload.js'), 'utf8');
const hashSource = await readFile(resolve(root, 'js/file-hash.js'), 'utf8');
const indexSource = await readFile(resolve(root, 'index.html'), 'utf8');
const serviceWorkerSource = await readFile(resolve(root, 'service-worker.js'), 'utf8');
const changelog = await readFile(resolve(root, 'CHANGELOG.md'), 'utf8');
const gallerySource = await readFile(resolve(root, 'js/gallery.js'), 'utf8');
const sitePickerSource = await readFile(resolve(root, 'js/site-picker.js'), 'utf8');
const styleSource = await readFile(resolve(root, 'css/style.css'), 'utf8');
const version = packageJson.version;

if (!configSource.includes(`APP_VERSION = '${version}'`)) {
  throw new Error('Versione non allineata tra package.json e js/config.js.');
}
if (!serviceWorkerSource.includes(`APP_VERSION = '${version}'`)) {
  throw new Error('Versione non allineata tra package.json e service-worker.js.');
}
if (!changelog.includes(`## [${version}]`)) {
  throw new Error('La versione corrente non e registrata in CHANGELOG.md.');
}

if (!configSource.includes('DB_VERSION = 4')) {
  throw new Error('La release deve migrare IndexedDB alla versione 4.');
}
if (!authSource.includes('restoreSession') || !authSource.includes("SESSION_SETTING_KEY = 'auth-session'")) {
  throw new Error('Sessione persistente non implementata.');
}
if (!appSource.includes('const sessionUser = await restoreSession()') || !appSource.includes('await logout()')) {
  throw new Error('Avvio automatico o logout persistente non collegati all interfaccia.');
}
if (!databaseSource.includes("ensureIndex(media, 'siteContentHash', ['siteId', 'contentHash'], { unique: true })")
  || !databaseSource.includes("ensureIndex(media, 'siteTypeSize', ['siteId', 'mediaType', 'size'])")
  || !databaseSource.includes("deleteIndex('contentHash')")) {
  throw new Error('Indici di deduplicazione per cantiere o migrazione indice globale mancanti.');
}
if (!hashSource.includes("digest('SHA-256'") || !uploadSource.includes('duplicati ignorati')) {
  throw new Error('Controllo SHA-256 o feedback duplicati mancante.');
}

if (appSource.includes('deleteMediaCascade')) {
  throw new Error('L\'interfaccia non deve bypassare i controlli autorizzativi di eliminazione media.');
}
if (/getAllRecords\(\s*STORE_NAMES\.MEDIA\s*\)/.test(databaseSource)) {
  throw new Error('E vietata una scansione completa dello store media.');
}
if (!indexSource.includes('<option value="">Seleziona un cantiere...</option>')) {
  throw new Error('Il filtro cantiere deve iniziare senza una selezione globale.');
}
if (!indexSource.includes('<option value="photo">Solo foto</option>')) {
  throw new Error('Il filtro media deve mantenere Solo foto come prima opzione.');
}

for (const requiredUploadId of [
  'upload-home',
  'upload-site-select',
  'home-photo-action',
  'home-video-action',
  'home-gallery-action',
  'open-archive-button',
]) {
  if (!indexSource.includes(`id="${requiredUploadId}"`)) {
    throw new Error(`Elemento upload-first mancante: ${requiredUploadId}.`);
  }
}
if (indexSource.includes('id="upload-fab"')) {
  throw new Error('Il vecchio pulsante flottante di upload non deve essere presente.');
}
if (!appSource.includes('let currentView = VIEW_MODES.UPLOAD')) {
  throw new Error('La prima vista operativa deve essere il caricamento.');
}
for (const removedLabel of [
  'I miei upload',
  'Preferiti archivio',
  'Preferiti upload',
  'OPERAZIONE PRINCIPALE',
  'Seleziona il cantiere e scegli subito come acquisire il materiale.',
  'Destinazione: Scegli una delle tre modalità qui sopra',
]) {
  if (indexSource.toLowerCase().includes(removedLabel.toLowerCase())) {
    throw new Error(`Testo o sezione da rimuovere ancora presente: ${removedLabel}.`);
  }
}
for (const requiredSitePickerId of [
  'upload-site-picker-trigger',
  'archive-site-picker-trigger',
  'site-picker-dialog',
]) {
  if (!indexSource.includes(`id="${requiredSitePickerId}"`)) {
    throw new Error(`Selettore cantieri preferiti mancante: ${requiredSitePickerId}.`);
  }
}
if (!indexSource.includes('./images/logo-spini.png')) {
  throw new Error('Logo Impresa Spini non collegato nell interfaccia.');
}
if (!sitePickerSource.includes('Tutti i cantieri') || !sitePickerSource.includes('Cantieri attivi') || !sitePickerSource.includes('Cantieri conclusi')) {
  throw new Error('Il selettore deve mostrare tutti i cantieri e i gruppi ordinati richiesti.');
}
for (const globalIndex of ['allDate', 'allTypeDate', 'allAuthorDate', 'allTypeAuthorDate']) {
  if (!databaseSource.includes(`'${globalIndex}'`)) {
    throw new Error(`Indice globale mancante per Tutti i cantieri: ${globalIndex}.`);
  }
}
if (!styleSource.includes('--background: #f5f4f1') || !styleSource.includes('--accent: #c92832')) {
  throw new Error('Palette neutra con accento aziendale non applicata.');
}
if (!indexSource.includes('id="gallery-gesture-hint"')
  || !indexSource.includes('id="gallery-zoom-indicator"')) {
  throw new Error('La galleria deve esporre guida e indicatore del pinch zoom.');
}
for (const requiredGalleryFeature of [
  'buildGalleryLayoutRows',
  'formatGalleryDateLabel',
  'calculatePinchColumns',
  'computeVirtualRowRange',
]) {
  if (!gallerySource.includes(requiredGalleryFeature)) {
    throw new Error(`Funzione galleria mancante: ${requiredGalleryFeature}.`);
  }
}

if (!indexSource.includes('id="viewer-video-center-toggle"')
  || !indexSource.includes('id="viewer-video-controls"')
  || !indexSource.includes('id="viewer-video-control-button"')) {
  throw new Error('I controlli video statici devono essere presenti nel viewer HTML.');
}
if (!indexSource.includes(`./js/bootstrap-${version}.js`)) {
  throw new Error('Il bootstrap versionato non e collegato in index.html.');
}

const required = [
  'index.html',
  'manifest.json',
  'service-worker.js',
  'repair.html',
  `js/bootstrap-${version}.js`,
  'css/style.css',
  'README.md',
  'ARCHITECTURE.md',
  'CHANGELOG.md',
  'SECURITY.md',
  'VERIFICATION.md',
  'images/logo-spini.png',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];
for (const item of required) await assertPath(resolve(root, item));

const shellBlock = /const APP_SHELL = \[([\s\S]*?)\];/.exec(serviceWorkerSource)?.[1];
if (!shellBlock) throw new Error('APP_SHELL non trovato nel Service Worker.');
const shellEntries = new Set();
for (const match of shellBlock.matchAll(/['"](\.\/[^'"]*)['"]/g)) {
  const entry = match[1];
  shellEntries.add(entry);
  const cleanEntry = entry.split(/[?#]/, 1)[0];
  const target = cleanEntry === './' ? resolve(root, 'index.html') : resolve(root, cleanEntry.slice(2));
  await assertPath(target, `APP_SHELL ${entry}`);
}

for (const name of await readdir(resolve(root, 'js'))) {
  if (!name.endsWith('.js')) continue;
  const entry = `./js/${name}`;
  const included = [...shellEntries].some((candidate) => candidate.split(/[?#]/, 1)[0] === entry);
  if (!included) {
    throw new Error(`Modulo applicativo non incluso nell'APP_SHELL: ${entry}`);
  }
}

for (const icon of manifest.icons ?? []) {
  const iconPath = resolve(root, String(icon.src).replace(/^\.\//, ''));
  await assertPath(iconPath, `manifest icon ${icon.src}`);
  if (extname(iconPath).toLowerCase() === '.png' && /^\d+x\d+$/.test(icon.sizes)) {
    const [expectedWidth, expectedHeight] = icon.sizes.split('x').map(Number);
    const actual = readPngSize(await readFile(iconPath));
    if (actual.width !== expectedWidth || actual.height !== expectedHeight) {
      throw new Error(`Dimensione errata per ${icon.src}: ${actual.width}x${actual.height}.`);
    }
  }
}

console.log(`Controllo completato: ${files.length} file JavaScript validi.`);
console.log(`Versione coerente: ${version}.`);
console.log(`Asset PWA e ${manifest.icons?.length ?? 0} icone verificati.`);
