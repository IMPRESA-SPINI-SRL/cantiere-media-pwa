import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chromium = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
  await Promise.race([exited, sleep(2000)]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([new Promise((resolveExit) => child.once('exit', resolveExit)), sleep(1000)]);
  }
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForHttp(url, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Retry while the process starts.
    }
    await sleep(100);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolveConnect, reject) => {
      this.socket.addEventListener('open', resolveConnect, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolveCommand, reject) => {
      this.pending.set(id, { resolve: resolveCommand, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  waitEvent(method, timeoutMs = 10000) {
    return new Promise((resolveEvent, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timeout waiting for ${method}`)), timeoutMs);
      const listener = (params) => {
        clearTimeout(timeout);
        const listeners = this.listeners.get(method) ?? [];
        this.listeners.set(method, listeners.filter((entry) => entry !== listener));
        resolveEvent(params);
      };
      this.on(method, listener);
    });
  }

  async evaluate(expression, { awaitPromise = true } = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description
        || result.exceptionDetails.text
        || 'Runtime evaluation failed.';
      throw new Error(description);
    }
    return result.result.value;
  }

  close() {
    this.socket?.close();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForCondition(cdp, expression, label, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await cdp.evaluate(expression, { awaitPromise: true })) return;
    await sleep(100);
  }
  let diagnostic = null;
  try {
    diagnostic = await cdp.evaluate(`({
      url: location.href,
      readyState: document.readyState,
      setupHidden: document.getElementById('setup-form')?.hidden,
      loginHidden: document.getElementById('login-form')?.hidden,
      authError: document.getElementById('auth-error')?.textContent,
      body: document.body?.innerText?.slice(0, 500)
    })`);
  } catch {
    diagnostic = 'unavailable';
  }
  throw new Error(`Timeout: ${label}\n${JSON.stringify(diagnostic)}`);
}

const serverPort = await freePort();
const cdpPort = await freePort();
const profile = await mkdtemp(join(tmpdir(), 'cantiere-media-smoke-'));
const server = spawn(process.execPath, ['tools/dev-server.mjs'], {
  cwd: root,
  env: { ...process.env, PORT: String(serverPort) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const browser = spawn(chromium, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${cdpPort}`,
  '--remote-debugging-address=127.0.0.1',
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

let cdp;
const browserErrors = [];
browser.stderr.on('data', (chunk) => {
  const text = String(chunk);
  if (/ERROR:CONSOLE/.test(text)) browserErrors.push(text.trim());
});

try {
  const appUrl = `http://127.0.0.1:${serverPort}/index.html`;
  await waitForHttp(`http://127.0.0.1:${serverPort}/index.html`);
  await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`);
  const targetResponse = await fetch(
    `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(appUrl)}`,
    { method: 'PUT' },
  );
  const target = await targetResponse.json();
  cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();

  const runtimeErrors = [];
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    runtimeErrors.push(exceptionDetails.exception?.description || exceptionDetails.text);
  });
  cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type === 'error') runtimeErrors.push(args.map((arg) => arg.value || arg.description).join(' '));
  });

  await Promise.all([
    cdp.send('Page.enable'),
    cdp.send('Runtime.enable'),
    cdp.send('DOM.enable'),
    cdp.send('Network.enable'),
  ]);
  const loaded = cdp.waitEvent('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: appUrl });
  await loaded;
  await waitForCondition(cdp, "document.getElementById('setup-form')?.hidden === false", 'setup screen');

  const initial = await cdp.evaluate(`({
    setupVisible: !document.getElementById('setup-form').hidden,
    appHidden: document.getElementById('app-screen').hidden,
    mediaFilter: document.getElementById('media-filter').value,
    siteFilter: document.getElementById('site-filter').value,
    cards: document.querySelectorAll('.gallery-card').length
  })`);
  assert(initial.setupVisible, 'First-run administrator setup is not visible.');
  assert(initial.appHidden, 'Application shell should be hidden before login.');
  assert(initial.mediaFilter === 'photo', 'Default media filter is not photo.');
  assert(initial.siteFilter === '', 'A site was selected at startup.');
  assert(initial.cards === 0, 'Media were loaded at startup.');

  await cdp.evaluate(`(() => {
    document.getElementById('setup-name').value = 'Amministratore';
    document.getElementById('setup-pin').value = '1234';
    document.getElementById('setup-pin-confirm').value = '1234';
    document.getElementById('setup-form').requestSubmit();
    return true;
  })()`);
  await waitForCondition(cdp, "document.getElementById('app-screen').hidden === false", 'application after setup', 20000);
  const emptyState = await cdp.evaluate(`({
    cards: document.querySelectorAll('.gallery-card').length,
    uploadHomeVisible: !document.getElementById('upload-home').hidden,
    archiveHidden: document.getElementById('archive-view').hidden,
    site: document.getElementById('upload-site-select').value,
    directActions: [
      'home-photo-action',
      'home-video-action',
      'home-gallery-action',
    ].every((id) => Boolean(document.getElementById(id)))
  })`);
  assert(emptyState.cards === 0, 'Media were loaded before choosing a site.');
  assert(emptyState.uploadHomeVisible && emptyState.archiveHidden,
    'The direct upload view is not the first operational screen.');
  assert(emptyState.site === '', 'A site was selected automatically.');
  assert(emptyState.directActions, 'Direct upload actions are incomplete.');

  await cdp.evaluate(`(() => {
    document.getElementById('menu-button').click();
    document.getElementById('manage-sites-button').click();
    return true;
  })()`);
  await waitForCondition(cdp, "document.getElementById('sites-dialog').open", 'site management dialog');
  await cdp.evaluate("document.getElementById('site-create-button').click()");
  await waitForCondition(cdp, "document.getElementById('site-editor-dialog').open", 'site editor');
  await cdp.evaluate(`(() => {
    document.getElementById('site-name').value = 'Cantiere Test';
    document.getElementById('site-client').value = 'Cliente Test';
    document.getElementById('site-address').value = 'Via Test 1';
    document.getElementById('site-editor-form').requestSubmit();
    return true;
  })()`);
  await waitForCondition(cdp, "document.getElementById('site-filter').options.length === 2 && document.getElementById('upload-site-select').options.length === 2", 'new site in upload and archive selectors');
  await cdp.evaluate("document.getElementById('sites-close').click()");

  await cdp.evaluate("document.getElementById('upload-site-picker-trigger').click()");
  await waitForCondition(cdp, "document.getElementById('site-picker-dialog').open", 'upload site picker');
  await cdp.evaluate("document.querySelector('#site-picker-dialog .site-picker-star').click()");
  await waitForCondition(
    cdp,
    "document.querySelector('#site-picker-dialog .site-picker-star')?.classList.contains('is-favorite')",
    'upload site favorite',
  );
  await cdp.evaluate("document.querySelector('#site-picker-dialog .site-picker-site').click()");
  await waitForCondition(
    cdp,
    "document.getElementById('site-filter').value === document.getElementById('upload-site-select').value && document.getElementById('upload-site-select').value !== ''",
    'synchronized upload destination',
  );

  const documentNode = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const inputNode = await cdp.send('DOM.querySelector', {
    nodeId: documentNode.root.nodeId,
    selector: '#gallery-input',
  });
  await cdp.send('DOM.setFileInputFiles', {
    nodeId: inputNode.nodeId,
    files: [resolve(root, 'icons/icon-192.png')],
  });
  await cdp.evaluate("document.getElementById('gallery-input').dispatchEvent(new Event('change', { bubbles: true }))");
  await waitForCondition(
    cdp,
    "document.getElementById('upload-home-feedback').classList.contains('is-success')",
    'direct upload confirmation',
    20000,
  );
  assert(await cdp.evaluate("document.querySelectorAll('.gallery-card').length === 0"),
    'Uploading from the primary screen must not load the hidden archive.');

  const mediaCount = await cdp.evaluate(`new Promise((resolveCount, rejectCount) => {
    const request = indexedDB.open('cantiere-media-db');
    request.onerror = () => rejectCount(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction('media', 'readonly');
      const count = transaction.objectStore('media').count();
      count.onsuccess = () => resolveCount(count.result);
      count.onerror = () => rejectCount(count.error);
    };
  })`);
  assert(mediaCount === 1, 'Uploaded media was not saved in IndexedDB.');

  await cdp.evaluate("document.getElementById('open-archive-button').click()");
  await waitForCondition(cdp, "document.querySelectorAll('.gallery-card').length === 1", 'uploaded gallery item', 20000);
  await waitForCondition(cdp, "document.querySelector('.gallery-card.has-thumbnail') !== null", 'lazy thumbnail', 20000);
  const datedGallery = await cdp.evaluate(`({
    dateHeaders: document.querySelectorAll('.gallery-date-row').length,
    columns: getComputedStyle(document.getElementById('gallery')).getPropertyValue('--gallery-columns').trim()
  })`);
  assert(datedGallery.dateHeaders === 1, 'Gallery date header is missing.');
  assert(datedGallery.columns === '3' || datedGallery.columns === '4', 'Gallery density was not initialized.');

  await cdp.evaluate("document.querySelector('.gallery-card').click()");
  await waitForCondition(cdp, "document.getElementById('viewer-dialog').open", 'viewer open');
  await waitForCondition(cdp, "document.querySelector('#viewer-transform img') !== null", 'viewer image');
  await cdp.evaluate("document.getElementById('viewer-close').click()");
  await waitForCondition(cdp, "!document.getElementById('viewer-dialog').open", 'viewer close');

  await cdp.evaluate(`(() => {
    const select = document.getElementById('media-filter');
    select.value = 'both';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await cdp.send('DOM.setFileInputFiles', {
    nodeId: inputNode.nodeId,
    files: [resolve(root, 'tests/fixtures/video-test.webm')],
  });
  await cdp.evaluate("document.getElementById('gallery-input').dispatchEvent(new Event('change', { bubbles: true }))");
  await waitForCondition(cdp, "document.querySelectorAll('.gallery-card').length === 2", 'uploaded test video', 20000);
  await waitForCondition(cdp, "document.querySelector('.gallery-card .video-badge') !== null", 'video card badge', 20000);

  await cdp.evaluate(`(() => {
    const videoCard = [...document.querySelectorAll('.gallery-card')]
      .find((card) => card.querySelector('.video-badge'));
    videoCard.click();
    return true;
  })()`);
  await waitForCondition(cdp, "document.querySelector('#viewer-transform video') !== null", 'viewer video');
  await waitForCondition(
    cdp,
    "document.querySelector('.viewer-video-center-toggle')?.hidden === false && document.querySelector('.viewer-video-controls')?.hidden === false",
    'visible static video controls',
  );
  const videoControls = await cdp.evaluate(`(() => {
    const center = document.querySelector('.viewer-video-center-toggle');
    const controls = document.querySelector('.viewer-video-controls');
    const centerStyle = getComputedStyle(center);
    const controlsStyle = getComputedStyle(controls);
    return {
      centerDisplay: centerStyle.display,
      centerOpacity: Number(centerStyle.opacity),
      centerWidth: center.getBoundingClientRect().width,
      controlsDisplay: controlsStyle.display,
      controlsHeight: controls.getBoundingClientRect().height,
      lowerButton: Boolean(controls.querySelector('.viewer-video-control-button')),
      progress: Boolean(controls.querySelector('.viewer-video-progress')),
      time: Boolean(controls.querySelector('.viewer-video-time')),
      outsideTransform: !document.getElementById('viewer-transform').contains(center)
        && !document.getElementById('viewer-transform').contains(controls),
    };
  })()`);
  assert(videoControls.centerDisplay !== 'none' && videoControls.centerOpacity > 0.5 && videoControls.centerWidth > 40,
    'Central Play control is not visible.');
  assert(videoControls.controlsDisplay !== 'none' && videoControls.controlsHeight > 40,
    'Bottom video controls are not visible.');
  assert(videoControls.lowerButton && videoControls.progress && videoControls.time,
    'Bottom video controls are incomplete.');
  assert(videoControls.outsideTransform, 'Video controls must remain outside the transformed media container.');

  await cdp.evaluate("document.querySelector('.viewer-video-center-toggle').click()");
  await waitForCondition(cdp, "document.querySelector('#viewer-transform video')?.paused === false", 'video playback');
  await cdp.evaluate("document.querySelector('.viewer-video-control-button').click()");
  await waitForCondition(cdp, "document.querySelector('#viewer-transform video')?.paused === true", 'video pause');
  await cdp.evaluate("document.getElementById('viewer-close').click()");
  await waitForCondition(cdp, "!document.getElementById('viewer-dialog').open", 'video viewer close');

  await cdp.evaluate(`(() => {
    const cards = [...document.querySelectorAll('.gallery-card')];
    cards[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    for (const card of cards.slice(1)) card.click();
    return true;
  })()`);
  await waitForCondition(cdp, "document.getElementById('selection-toolbar').hidden === false", 'long-press selection mode');
  await cdp.evaluate("document.getElementById('selection-delete').click()");
  await waitForCondition(cdp, "document.querySelector('.confirm-dialog[open]') !== null", 'media deletion confirmation');
  await cdp.evaluate("document.querySelector('.confirm-dialog[open] [data-confirm-ok]').click()");
  await waitForCondition(cdp, "document.querySelectorAll('.gallery-card').length === 0", 'media deletion', 15000);

  const remainingMedia = await cdp.evaluate(`new Promise((resolveCount, rejectCount) => {
    const request = indexedDB.open('cantiere-media-db');
    request.onerror = () => rejectCount(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction('media', 'readonly');
      const media = transaction.objectStore('media').count();
      media.onsuccess = () => resolveCount(media.result);
      media.onerror = () => rejectCount(media.error);
    };
  })`);
  assert(remainingMedia === 0, 'Media metadata was not deleted.');

  await cdp.evaluate(`(() => {
    document.getElementById('menu-button').click();
    document.getElementById('manage-sites-button').click();
    return true;
  })()`);
  await waitForCondition(cdp, "document.getElementById('sites-dialog').open", 'site management before deletion');
  await cdp.evaluate(`(() => {
    const card = [...document.querySelectorAll('.management-card')]
      .find((entry) => entry.querySelector('h3')?.textContent === 'Cantiere Test');
    [...card.querySelectorAll('button')].find((button) => button.textContent === 'Elimina').click();
    return true;
  })()`);
  await waitForCondition(cdp, "document.querySelector('.confirm-dialog[open]') !== null", 'first site confirmation');
  await cdp.evaluate("document.querySelector('.confirm-dialog[open] [data-confirm-ok]').click()");
  await waitForCondition(cdp, "document.querySelector('.confirm-dialog[open] [data-confirm-input]') !== null", 'second site confirmation');
  await cdp.evaluate(`(() => {
    const dialog = document.querySelector('.confirm-dialog[open]');
    const input = dialog.querySelector('[data-confirm-input]');
    input.value = 'Cantiere Test';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    dialog.querySelector('[data-confirm-ok]').click();
    return true;
  })()`);
  await waitForCondition(cdp, "document.getElementById('site-filter').options.length === 1", 'site deletion', 15000);

  const worker = await cdp.evaluate(`(async () => {
    await navigator.serviceWorker.ready;
    const keys = await caches.keys();
    return { controlled: Boolean(navigator.serviceWorker.controller), keys };
  })()`);
  assert(worker.keys.some((key) => key.startsWith('cantiere-media-shell-')), 'Application shell cache is missing.');

  await cdp.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
    connectionType: 'none',
  });
  const reloaded = cdp.waitEvent('Page.loadEventFired', 15000);
  await cdp.send('Page.reload', { ignoreCache: false });
  await reloaded;
  await waitForCondition(cdp, "document.getElementById('login-form')?.hidden === false", 'offline login screen', 15000);

  assert(runtimeErrors.length === 0, `Runtime errors: ${runtimeErrors.join('\n')}`);
  assert(browserErrors.length === 0, `Browser console errors: ${browserErrors.join('\n')}`);
  console.log('Browser smoke test completed successfully.');
} finally {
  cdp?.close();
  await stopProcess(browser);
  await stopProcess(server);
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}
