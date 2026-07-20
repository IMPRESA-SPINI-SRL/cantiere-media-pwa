const APP_VERSION = '1.0.3';
const CACHE_PREFIX = 'cantiere-media-shell-';
const CURRENT_CACHE = `${CACHE_PREFIX}${APP_VERSION}`;

async function requiresCacheRepair() {
  const cacheNames = 'caches' in globalThis ? await caches.keys() : [];
  if (cacheNames.some((name) => name.startsWith(CACHE_PREFIX) && name !== CURRENT_CACHE)) {
    return true;
  }

  if (!('serviceWorker' in navigator)) return false;
  const registration = await navigator.serviceWorker.getRegistration('./');
  const activeUrl = registration?.active?.scriptURL;
  if (!activeUrl) return false;
  return new URL(activeUrl).searchParams.get('v') !== APP_VERSION;
}

try {
  if (await requiresCacheRepair()) {
    location.replace(`./repair.html?target=${APP_VERSION}&time=${Date.now()}`);
  } else {
    await import(`./app.js?v=${APP_VERSION}`);
  }
} catch (error) {
  console.error('Avvio applicazione non riuscito.', error);
  const message = document.createElement('p');
  message.className = 'bootstrap-error';
  message.textContent = 'Impossibile avviare l\'applicazione. Ricarica la pagina con il server attivo.';
  document.body.append(message);
}
