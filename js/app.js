import {
  ALL_SITES_ID,
  APP_VERSION,
  MEDIA_TYPES,
  ROLES,
  SITE_STATUSES,
  VIEW_MODES,
} from './config.js?v=1.8.1';
import { updateCurrentUserSnapshot } from './auth.js?v=1.8.1';
import {
  activateCentralUser,
  getLastUsername,
  listCentralUsers,
  loginCentralUser,
  logoutCentralUser,
  restoreCentralSession,
  verifyCentralSession,
} from './remote-auth.js?v=1.8.1';
import {
  getStorageCounts,
  openDatabase,
} from './db.js?v=1.8.1';
import { FilterController, viewModeLabel } from './filters.js?v=1.8.1';
import { GalleryController } from './gallery.js?v=1.8.1';
import {
  getSiteFavoriteIds,
  SITE_FAVORITE_CONTEXTS,
  sortSitesByFavorites,
  toggleSiteFavorite,
} from './site-favorites.js?v=1.8.1';
import { SitePickerController } from './site-picker.js?v=1.8.1';
import { synchronizeSites } from './site-sync.js?v=1.8.1';
import { synchronizeCentralMedia } from './central-media-sync.js?v=1.8.1';
import {
  downloadMedia,
  deleteMediaItems,
  getStorageEstimate,
  partitionMediaByType,
  shareMediaItems,
} from './media.js?v=1.8.1';
import {
  getMediaSyncSummary,
  synchronizeMedia,
} from './media-sync.js?v=1.8.1';
import { isAdministrator, splitMediaByDeletionPermission } from './permissions.js?v=1.8.1';
import {
  createSite,
  deleteSiteInBatches,
  getSiteMediaCount,
  listSites,
  resumePendingSiteDeletions,
  updateSite,
} from './sites.js?v=1.8.1';
import { UploadController } from './upload.js?v=1.8.1';
import {
  createUser,
  listUsers,
  updateUser,
} from './users.js?v=1.8.1';
import {
  byId,
  closeDialog,
  confirmAction,
  openDialog,
  setBusy,
  showAlert,
  showToast,
} from './ui.js?v=1.8.1';
import { debounce, formatBytes } from './utils.js?v=1.8.1';
import { ViewerController } from './viewer.js?v=1.8.1';

let currentUser = null;
let sitesCache = [];
let usersCache = [];
let currentView = VIEW_MODES.UPLOAD;
let deferredInstallPrompt = null;
let filterController;
let galleryController;
let uploadController;
let viewerController;
let sitePickerController;
let siteFavoriteIds = {
  [SITE_FAVORITE_CONTEXTS.ARCHIVE]: new Set(),
  [SITE_FAVORITE_CONTEXTS.UPLOAD]: new Set(),
};
let userEditorOriginal = null;
let centralUsersCache = [];
let sessionRevalidationRunning = false;
let mediaSyncTimer = null;

const reloadGallery = debounce((filters) => {
  if (currentUser && currentView !== VIEW_MODES.UPLOAD) galleryController.reload(filters);
}, 100);

function showAuthError(message = '') {
  const element = byId('auth-error');
  element.textContent = message;
  element.hidden = !message;
}

function submitButtonFor(event) {
  return event.submitter ?? event.currentTarget.querySelector('[type="submit"]');
}

function activeSite() {
  const siteId = filterController.getValue().siteId;
  if (siteId === ALL_SITES_ID) return null;
  return sitesCache.find((site) => site.id === siteId) ?? null;
}

function siteDisplayName(site) {
  if (!site) return 'Seleziona un cantiere...';
  return site.status === SITE_STATUSES.COMPLETED ? `${site.name} (concluso)` : site.name;
}

function orderedSites(context) {
  return sortSitesByFavorites(sitesCache, siteFavoriteIds[context]);
}

function populateUploadSiteSelect(selectedId = filterController?.getValue().siteId) {
  const select = byId('upload-site-select');
  select.replaceChildren(new Option('Seleziona un cantiere...', ''));
  for (const site of orderedSites(SITE_FAVORITE_CONTEXTS.UPLOAD)) {
    select.add(new Option(siteDisplayName(site), site.id));
  }
  select.value = sitesCache.some((site) => site.id === selectedId) ? selectedId : '';
  byId('upload-site-picker-trigger').closest('.upload-site-field')?.classList.remove('is-missing');
  updateSitePickerTriggers();
}

function updateSitePickerTrigger(triggerId, context, selectedId) {
  const trigger = byId(triggerId);
  const allSites = context === SITE_FAVORITE_CONTEXTS.ARCHIVE && selectedId === ALL_SITES_ID;
  const site = allSites ? null : sitesCache.find((item) => item.id === selectedId) ?? null;
  trigger.querySelector('.site-picker-trigger-label').textContent = allSites ? 'Tutti i cantieri' : siteDisplayName(site);
  const favorite = Boolean(site && siteFavoriteIds[context].has(site.id));
  trigger.classList.toggle('has-favorite', favorite);
  trigger.setAttribute('aria-label', allSites
    ? 'Tutti i cantieri. Apri elenco cantieri.'
    : site
      ? `${siteDisplayName(site)}. Apri elenco cantieri.`
      : 'Seleziona un cantiere.');
}

function updateSitePickerTriggers() {
  const selectedId = filterController?.getValue().siteId ?? '';
  updateSitePickerTrigger('upload-site-picker-trigger', SITE_FAVORITE_CONTEXTS.UPLOAD, selectedId);
  updateSitePickerTrigger('archive-site-picker-trigger', SITE_FAVORITE_CONTEXTS.ARCHIVE, selectedId);
}

function synchronizeUploadSite(siteId) {
  const select = byId('upload-site-select');
  if (select.value !== (siteId ?? '')) select.value = siteId ?? '';
  updateSitePickerTriggers();
}

function handleFilterChange(filters) {
  synchronizeUploadSite(filters.siteId);
  reloadGallery(filters);
}

async function handleSiteFavoriteToggle(siteId, context) {
  try {
    const result = await toggleSiteFavorite(currentUser.id, context, siteId);
    siteFavoriteIds[context] = new Set(result.ids);
    const selectedId = filterController.getValue().siteId;
    if (context === SITE_FAVORITE_CONTEXTS.ARCHIVE) {
      filterController.setSites(orderedSites(context), selectedId);
    } else {
      populateUploadSiteSelect(selectedId);
    }
    updateSitePickerTriggers();
    return result;
  } catch (error) {
    showToast(error?.message ?? 'Preferenza del cantiere non salvata.', { type: 'error' });
    return null;
  }
}

function openSitePicker(context) {
  const isUpload = context === SITE_FAVORITE_CONTEXTS.UPLOAD;
  sitePickerController.open({
    title: isUpload ? 'Cantiere di destinazione' : 'Cantiere archivio',
    context,
    sites: orderedSites(context),
    favoriteIds: siteFavoriteIds[context],
    selectedId: filterController.getValue().siteId,
    allowAllSites: !isUpload,
    onSelect: (siteId) => {
      if (isUpload) {
        byId('upload-site-select').value = siteId;
        filterController.setSite(siteId, { notify: false });
        byId('upload-site-picker-trigger').closest('.upload-site-field')?.classList.remove('is-missing');
        updateUploadHomeFeedback();
        updateSitePickerTriggers();
      } else {
        filterController.setSite(siteId);
      }
    },
    onToggleFavorite: handleSiteFavoriteToggle,
  });
}

function updateUploadHomeFeedback(saved = []) {
  const feedback = byId('upload-home-feedback');
  if (!saved.length) {
    feedback.hidden = true;
    feedback.classList.remove('is-success');
    return;
  }
  feedback.hidden = false;
  feedback.classList.add('is-success');
  feedback.querySelector('strong').textContent = saved.length === 1
    ? '1 elemento salvato'
    : `${saved.length} elementi salvati`;
  feedback.querySelector('span').textContent = `Cantiere: ${activeSite()?.name ?? 'selezionato'}. Disponibili anche offline.`;
}

function mediaCountLabel(count) {
  return count === 1 ? '1 file' : `${count} file`;
}

function renderMediaSyncStatus(state = {}) {
  const card = byId('media-sync-card');
  const title = byId('media-sync-title');
  const text = byId('media-sync-text');
  const progress = byId('media-sync-progress');
  const retry = byId('media-sync-retry');
  if (!card || !title || !text || !progress || !retry) return;

  card.classList.remove('is-syncing', 'is-complete', 'is-warning', 'is-error');
  retry.hidden = true;
  progress.hidden = true;

  const summary = state.summary ?? state;
  const pending = Number(summary.pending || 0);
  const failed = Number(summary.failed || 0);
  const totalBytes = Number(summary.totalBytes || 0);
  const uploadedBytes = Number(summary.uploadedBytes || 0);

  if (state.phase === 'uploading') {
    const total = Math.max(1, Number(state.totalBytes || 0));
    const uploaded = Math.min(total, Math.max(0, Number(state.uploadedBytes || 0)));
    const percent = Math.floor((uploaded / total) * 100);
    card.classList.add('is-syncing');
    title.textContent = 'Caricamento su OneDrive';
    text.textContent = `${state.media?.fileName || 'File'} - ${percent}%`;
    progress.max = total;
    progress.value = uploaded;
    progress.hidden = false;
    return;
  }

  if (state.phase === 'starting') {
    title.textContent = 'Preparazione OneDrive';
    text.textContent = pending
      ? `${mediaCountLabel(pending)} in attesa di caricamento.`
      : 'Controllo dei caricamenti completato.';
    if (pending) card.classList.add('is-syncing');
  } else if (state.phase === 'error') {
    card.classList.add('is-error');
    title.textContent = 'Caricamento non completato';
    text.textContent = state.error?.message || 'Si è verificato un errore durante il caricamento.';
    retry.hidden = false;
    return;
  } else if (!navigator.onLine || state.phase === 'offline') {
    title.textContent = pending ? 'OneDrive in attesa' : 'OneDrive aggiornato';
    text.textContent = pending
      ? `${mediaCountLabel(pending)} verranno caricati appena torna la connessione.`
      : 'Nessun file in attesa di caricamento.';
    card.classList.add(pending ? 'is-warning' : 'is-complete');
  } else if (!pending) {
    card.classList.add('is-complete');
    title.textContent = 'OneDrive aggiornato';
    text.textContent = 'Tutti i file sono stati caricati.';
  } else if (failed) {
    card.classList.add('is-error');
    title.textContent = 'Caricamenti da riprovare';
    text.textContent = `${mediaCountLabel(pending)} in attesa, ${failed} non completati.`;
    retry.hidden = false;
  } else {
    card.classList.add('is-warning');
    title.textContent = 'Caricamenti in attesa';
    text.textContent = `${mediaCountLabel(pending)} saranno inviati automaticamente a OneDrive.`;
  }

  if (pending && totalBytes > 0 && uploadedBytes > 0) {
    progress.max = totalBytes;
    progress.value = Math.min(totalBytes, uploadedBytes);
    progress.hidden = false;
  }
}

async function refreshMediaSyncStatus() {
  try {
    const summary = await getMediaSyncSummary();
    renderMediaSyncStatus({
      phase: navigator.onLine ? 'idle' : 'offline',
      summary,
    });
    return summary;
  } catch (error) {
    console.warn('Stato caricamenti OneDrive non disponibile.', error);
    renderMediaSyncStatus({ phase: 'error', error });
    return null;
  }
}

function scheduleMediaSynchronization(delay = 500, { force = false } = {}) {
  if (!currentUser || !navigator.onLine) return;
  clearTimeout(mediaSyncTimer);
  mediaSyncTimer = setTimeout(() => {
    mediaSyncTimer = null;
    runMediaSynchronization({ force }).catch((error) => {
      console.warn('Sincronizzazione OneDrive non completata.', error);
    });
  }, Math.max(0, Number(delay || 0)));
}

async function runMediaSynchronization({ force = false, announce = false } = {}) {
  if (!currentUser) return null;
  if (!navigator.onLine) return refreshMediaSyncStatus();

  try {
    const result = await synchronizeMedia({
      force,
      onProgress: renderMediaSyncStatus,
    });
    const summary = await refreshMediaSyncStatus();
    await updateMenuStorage();

    if (announce && result?.completed) {
      showToast(
        result.completed === 1
          ? '1 file caricato su OneDrive.'
          : `${result.completed} file caricati su OneDrive.`,
        { type: 'success' },
      );
    }

    if (summary?.pending && navigator.onLine) {
      const now = Date.now();
      const nextAttempt = Number(summary.nextAttemptAt || 0);
      const delay = nextAttempt > now
        ? Math.min(15 * 60 * 1000, nextAttempt - now + 250)
        : 1500;
      scheduleMediaSynchronization(delay);
    }
    return result;
  } catch (error) {
    renderMediaSyncStatus({ phase: 'error', error });
    if (announce) showToast(error?.message ?? 'Caricamento OneDrive non riuscito.', { type: 'error' });
    throw error;
  }
}

function startHomeUpload(methodName) {
  if (!activeSite()) {
    const field = byId('upload-site-picker-trigger').closest('.upload-site-field');
    field?.classList.add('is-missing');
    byId('upload-site-picker-trigger').focus();
    showToast('Seleziona prima il cantiere di destinazione.', { type: 'warning' });
    return;
  }
  byId('upload-site-picker-trigger').closest('.upload-site-field')?.classList.remove('is-missing');
  uploadController[methodName]();
}

function initializeControllers() {
  filterController = new FilterController({
    siteSelect: byId('site-filter'),
    mediaSelect: byId('media-filter'),
    authorSelect: byId('author-filter'),
    dateInput: byId('date-filter'),
    onChange: handleFilterChange,
  });

  galleryController = new GalleryController({
    container: byId('gallery'),
    status: byId('gallery-status'),
    sentinel: byId('gallery-sentinel'),
    gestureHint: byId('gallery-gesture-hint'),
    zoomIndicator: byId('gallery-zoom-indicator'),
    onOpen: (index) => viewerController.open(index),
    onSelectionChange: updateSelectionToolbar,
    beforeReload: async (filters) => {
      if (!currentUser || !navigator.onLine || !filters?.siteId) return null;
      const result = await synchronizeCentralMedia(filters.siteId);
      if (result.changed) updateMenuStorage();
      return result;
    },
  });

  viewerController = new ViewerController({
    dialog: byId('viewer-dialog'),
    stage: byId('viewer-stage'),
    transform: byId('viewer-transform'),
    closeButton: byId('viewer-close'),
    shareButton: byId('viewer-share'),
    position: byId('viewer-position'),
    caption: byId('viewer-caption'),
    photoControls: byId('viewer-photo-controls'),
    zoomOutButton: byId('viewer-zoom-out'),
    fitButton: byId('viewer-fit'),
    zoomInButton: byId('viewer-zoom-in'),
    videoCenterButton: byId('viewer-video-center-toggle'),
    videoControls: byId('viewer-video-controls'),
    videoControlButton: byId('viewer-video-control-button'),
    videoProgress: byId('viewer-video-progress'),
    videoTime: byId('viewer-video-time'),
    getItems: () => galleryController.getItems(),
    getHasMore: () => galleryController.hasMoreItems(),
    ensureIndex: (index) => galleryController.ensureIndex(index),
    onClose: () => {},
  });

  sitePickerController = new SitePickerController({
    dialog: byId('site-picker-dialog'),
    title: byId('site-picker-title'),
    list: byId('site-picker-list'),
    closeButton: byId('site-picker-close'),
  });

  uploadController = new UploadController({
    dialog: byId('upload-dialog'),
    photoButton: byId('upload-photo-action'),
    videoButton: byId('upload-video-action'),
    galleryButton: byId('upload-gallery-action'),
    photoInput: byId('photo-input'),
    videoInput: byId('video-input'),
    galleryInput: byId('gallery-input'),
    progressWrap: byId('upload-progress-wrap'),
    progress: byId('upload-progress'),
    progressText: byId('upload-progress-text'),
    closeButton: byId('upload-close'),
    directButtons: [
      byId('home-photo-action'),
      byId('home-video-action'),
      byId('home-gallery-action'),
    ],
    getContext: () => ({ site: activeSite(), user: currentUser }),
    onUploaded: async (saved) => {
      updateUploadHomeFeedback(saved);
      await refreshMediaSyncStatus();
      scheduleMediaSynchronization(250);
      if (currentView !== VIEW_MODES.UPLOAD) {
        await galleryController.reload(filterController.getValue());
      }
    },
  });
}

function bindStaticEvents() {
  byId('activation-form').addEventListener('submit', handleActivation);
  byId('login-form').addEventListener('submit', handleLogin);
  byId('login-user').addEventListener('change', updateAuthMode);
  byId('auth-refresh-users').addEventListener('click', refreshCentralUsers);
  byId('menu-button').addEventListener('click', openMenu);
  byId('menu-close').addEventListener('click', () => closeDialog(byId('menu-dialog')));
  byId('menu-dialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDialog(byId('menu-dialog'));
  });
  byId('selection-close').addEventListener('click', () => galleryController.clearSelection());
  byId('selection-share').addEventListener('click', shareSelection);
  byId('selection-delete').addEventListener('click', deleteSelection);
  byId('logout-button').addEventListener('click', handleLogout);
  byId('manage-sites-button').addEventListener('click', openSitesManagement);
  byId('manage-users-button').addEventListener('click', openUsersManagement);
  byId('install-app-button').addEventListener('click', installApplication);
  byId('home-photo-action').addEventListener('click', () => startHomeUpload('startPhotoCapture'));
  byId('home-video-action').addEventListener('click', () => startHomeUpload('startVideoCapture'));
  byId('home-gallery-action').addEventListener('click', () => startHomeUpload('startGalleryImport'));
  byId('open-archive-button').addEventListener('click', () => setView(VIEW_MODES.ARCHIVE));
  byId('media-sync-retry').addEventListener('click', () => {
    runMediaSynchronization({ force: true, announce: true }).catch(() => {});
  });
  byId('upload-site-picker-trigger').addEventListener('click', () => openSitePicker(SITE_FAVORITE_CONTEXTS.UPLOAD));
  byId('archive-site-picker-trigger').addEventListener('click', () => openSitePicker(SITE_FAVORITE_CONTEXTS.ARCHIVE));

  for (const button of document.querySelectorAll('[data-view]')) {
    button.addEventListener('click', () => setView(button.dataset.view));
  }

  byId('sites-close').addEventListener('click', () => closeDialog(byId('sites-dialog')));
  byId('site-create-button').addEventListener('click', () => openSiteEditor());
  byId('site-editor-close').addEventListener('click', closeSiteEditor);
  byId('site-editor-cancel').addEventListener('click', closeSiteEditor);
  byId('site-editor-form').addEventListener('submit', saveSiteEditor);

  byId('users-close').addEventListener('click', () => closeDialog(byId('users-dialog')));
  byId('user-create-button').addEventListener('click', () => openUserEditor());
  byId('user-editor-close').addEventListener('click', closeUserEditor);
  byId('user-editor-cancel').addEventListener('click', closeUserEditor);
  byId('user-editor-form').addEventListener('submit', saveUserEditor);

  window.addEventListener('online', handleOnlineConnection);
  window.addEventListener('offline', () => {
    updateConnectionStatus();
    refreshMediaSyncStatus();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentUser) {
      refreshMediaSyncStatus();
      scheduleMediaSynchronization(300);
      if (currentView !== VIEW_MODES.UPLOAD && navigator.onLine) {
        reloadGallery(filterController.getValue());
      }
    }
  });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallButton();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    updateInstallButton();
    showToast('Applicazione installata.', { type: 'success' });
  });
  window.addEventListener('app:database-blocked', () => {
    showToast('Chiudi le altre finestre dell\'app per completare l\'aggiornamento.', {
      type: 'warning',
      duration: 7000,
    });
  });
}

async function start() {
  initializeControllers();
  bindStaticEvents();
  updateConnectionStatus();
  updateInstallButton();
  byId('version-label').textContent = `Versione ${APP_VERSION}`;
  const authVersionLabel = byId('auth-version-label');
  if (authVersionLabel) authVersionLabel.textContent = `Versione ${APP_VERSION}`;
  registerServiceWorker();

  try {
    await openDatabase();
    const sessionUser = await restoreCentralSession();
    if (sessionUser) await enterApplication(sessionUser);
    else await showCentralAuthScreen();
  } catch (error) {
    await showCentralAuthScreen({ initialError: error?.message });
  }
}

function selectedCentralUser() {
  const username = byId('login-user').value;
  return centralUsersCache.find((user) => user.username === username) ?? null;
}

function updateAuthMode() {
  const user = selectedCentralUser();
  const activationForm = byId('activation-form');
  const loginForm = byId('login-form');
  const status = byId('auth-user-status');

  activationForm.hidden = true;
  loginForm.hidden = true;
  status.textContent = '';

  if (!user) return;

  const pending = user.status === 'pending-activation' || user.pinConfigured !== true;
  if (pending) {
    activationForm.hidden = false;
    status.textContent = 'Prima attivazione richiesta.';
    setTimeout(() => byId('activation-code').focus(), 0);
  } else {
    loginForm.hidden = false;
    status.textContent = 'Utente già attivato.';
    setTimeout(() => byId('login-pin').focus(), 0);
  }
}

async function showCentralAuthScreen({ initialError = '', forceNetwork = false } = {}) {
  byId('app-screen').hidden = true;
  byId('auth-screen').hidden = false;
  byId('activation-form').hidden = true;
  byId('login-form').hidden = true;
  showAuthError(initialError);

  const networkStatus = byId('auth-network-status');
  networkStatus.textContent = navigator.onLine
    ? 'Collegamento al servizio aziendale...'
    : 'Offline: per il primo accesso serve una connessione internet.';

  try {
    const result = await listCentralUsers({ allowCache: !forceNetwork });
    centralUsersCache = result.users;
    const select = byId('login-user');
    select.replaceChildren();

    for (const user of centralUsersCache) {
      select.add(new Option(user.displayName, user.username));
    }

    const lastUsername = getLastUsername();
    if (centralUsersCache.some((user) => user.username === lastUsername)) {
      select.value = lastUsername;
    }

    networkStatus.textContent = result.source === 'network'
      ? 'Servizio aziendale collegato.'
      : 'Elenco utenti disponibile offline. Per accedere senza una sessione salvata serve internet.';

    if (!centralUsersCache.length) {
      showAuthError('Nessun utente disponibile. Controlla la connessione e aggiorna l’elenco.');
      return;
    }

    byId('activation-code').value = '';
    byId('activation-pin').value = '';
    byId('activation-pin-confirm').value = '';
    byId('login-pin').value = '';
    updateAuthMode();
  } catch (error) {
    centralUsersCache = [];
    byId('login-user').replaceChildren();
    networkStatus.textContent = 'Servizio aziendale non raggiungibile.';
    showAuthError(error?.message ?? 'Impossibile caricare l’elenco utenti.');
  }
}

async function handleActivation(event) {
  event.preventDefault();
  showAuthError('');
  const user = selectedCentralUser();
  if (!user) {
    showAuthError('Seleziona un utente.');
    return;
  }

  const pin = byId('activation-pin').value;
  if (pin !== byId('activation-pin-confirm').value) {
    showAuthError('I PIN non coincidono.');
    return;
  }

  const submit = submitButtonFor(event);
  if (submit) submit.disabled = true;
  try {
    const localUser = await activateCentralUser({
      username: user.username,
      activationCode: byId('activation-code').value,
      pin,
    });
    await enterApplication(localUser);
  } catch (error) {
    showAuthError(error?.message ?? 'Attivazione non riuscita.');
    byId('activation-code').select();
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function handleLogin(event) {
  event.preventDefault();
  showAuthError('');
  const user = selectedCentralUser();
  if (!user) {
    showAuthError('Seleziona un utente.');
    return;
  }

  const submit = submitButtonFor(event);
  if (submit) submit.disabled = true;
  try {
    const localUser = await loginCentralUser({
      username: user.username,
      pin: byId('login-pin').value,
    });
    await enterApplication(localUser);
  } catch (error) {
    showAuthError(error?.message ?? 'Accesso non riuscito.');
    byId('login-pin').select();
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function refreshCentralUsers() {
  showAuthError('');
  await showCentralAuthScreen({ forceNetwork: navigator.onLine });
}

async function handleOnlineConnection() {
  updateConnectionStatus();
  if (sessionRevalidationRunning) return;

  if (!currentUser) {
    if (!byId('auth-screen').hidden) await showCentralAuthScreen();
    return;
  }

  sessionRevalidationRunning = true;
  try {
    const verifiedUser = await verifyCentralSession();
    if (!verifiedUser) {
      currentUser = null;
      clearTimeout(mediaSyncTimer);
      mediaSyncTimer = null;
      sitesCache = [];
      usersCache = [];
      await showCentralAuthScreen({ initialError: 'La sessione non è più valida. Accedi nuovamente.' });
      return;
    }
    currentUser = verifiedUser;
    updateCurrentUserUi();
    const syncResult = await refreshMetadata();
    await refreshMediaSyncStatus();
    scheduleMediaSynchronization(250);
    if (currentView !== VIEW_MODES.UPLOAD) {
      await galleryController.reload(filterController.getValue());
    }
    if (syncResult?.changed) {
      showToast('Elenco cantieri sincronizzato.', { type: 'success' });
    }
  } catch (error) {
    console.warn('Verifica sessione non completata.', error);
  } finally {
    sessionRevalidationRunning = false;
  }
}

async function enterApplication(user) {
  currentUser = user;
  byId('auth-screen').hidden = true;
  byId('app-screen').hidden = false;
  updateCurrentUserUi();
  await refreshMetadata();
  setView(VIEW_MODES.UPLOAD, { closeMenu: false });
  await refreshMediaSyncStatus();
  scheduleMediaSynchronization(400);
  updateMenuStorage();
  resumeInterruptedDeletions();
}

function updateCurrentUserUi() {
  if (!currentUser) return;
  byId('current-user-name').textContent = currentUser.name;
  byId('menu-user-label').textContent = currentUser.role === ROLES.ADMIN
    ? `${currentUser.name} - Amministratore`
    : currentUser.name;
  byId('admin-menu').hidden = !isAdministrator(currentUser);
  byId('manage-users-button').hidden = true;
}

async function refreshMetadata() {
  const selectedSiteId = filterController?.getValue().siteId;
  let syncResult = null;
  if (navigator.onLine && currentUser) {
    try {
      syncResult = await synchronizeSites(currentUser);
    } catch (error) {
      console.warn('Sincronizzazione cantieri non completata.', error);
      if (error?.code !== 'NETWORK_ERROR') {
        showToast(error?.message ?? 'Sincronizzazione cantieri non riuscita.', { type: 'warning' });
      }
    }
  }
  const [users, sites, archiveFavorites, uploadFavorites] = await Promise.all([
    listUsers(),
    listSites(),
    getSiteFavoriteIds(currentUser.id, SITE_FAVORITE_CONTEXTS.ARCHIVE),
    getSiteFavoriteIds(currentUser.id, SITE_FAVORITE_CONTEXTS.UPLOAD),
  ]);
  usersCache = users;
  sitesCache = sites;
  siteFavoriteIds = {
    [SITE_FAVORITE_CONTEXTS.ARCHIVE]: new Set(archiveFavorites),
    [SITE_FAVORITE_CONTEXTS.UPLOAD]: new Set(uploadFavorites),
  };
  filterController.setUsers(usersCache);
  filterController.setSites(orderedSites(SITE_FAVORITE_CONTEXTS.ARCHIVE), selectedSiteId);
  populateUploadSiteSelect(filterController.getValue().siteId);
  updateSitePickerTriggers();
  updateUploadHomeFeedback();
  return syncResult;
}

function setView(viewMode, { closeMenu = true } = {}) {
  if (!Object.values(VIEW_MODES).includes(viewMode)) return;
  currentView = viewMode;
  const isUploadHome = viewMode === VIEW_MODES.UPLOAD;
  byId('view-title').textContent = viewModeLabel(viewMode);
  byId('upload-home').hidden = !isUploadHome;
  byId('archive-view').hidden = isUploadHome;
  for (const button of document.querySelectorAll('[data-view]')) {
    button.classList.toggle('is-active', button.dataset.view === viewMode);
  }
  if (isUploadHome) {
    galleryController.clearSelection();
    updateUploadHomeFeedback();
  } else {
    filterController.setViewMode(viewMode, currentUser);
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (closeMenu) closeDialog(byId('menu-dialog'));
}

function openMenu() {
  updateMenuStorage();
  openDialog(byId('menu-dialog'));
}

function updateSelectionToolbar(items) {
  const toolbar = byId('selection-toolbar');
  toolbar.hidden = items.length === 0;
  byId('selection-count').textContent = String(items.length);
}

function pluralLabel(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function shareMixedSelection(photos, videos) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal mixed-share-dialog';
  dialog.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <h2>Condivisione foto e video</h2>
      </div>
      <p class="muted">WhatsApp su Android non accetta foto e video nello stesso invio. Condividili in due passaggi.</p>
      <div class="upload-actions">
        <button type="button" class="upload-action" data-share-photos></button>
        <button type="button" class="upload-action" data-share-videos></button>
      </div>
      <div class="modal-actions">
        <button type="button" class="button button-text" data-share-close>Chiudi</button>
      </div>
    </div>`;
  document.body.append(dialog);

  const photoButton = dialog.querySelector('[data-share-photos]');
  const videoButton = dialog.querySelector('[data-share-videos]');
  const closeButton = dialog.querySelector('[data-share-close]');
  photoButton.textContent = `Condividi ${pluralLabel(photos.length, 'foto', 'foto')}`;
  videoButton.textContent = `Condividi ${pluralLabel(videos.length, 'video', 'video')}`;

  return new Promise((resolve) => {
    const completed = new Set();

    const finish = () => {
      closeDialog(dialog);
      dialog.remove();
      resolve();
    };

    const shareGroup = async (type, items, button) => {
      button.disabled = true;
      try {
        await shareMediaItems(items);
        completed.add(type);
        button.textContent = type === MEDIA_TYPES.PHOTO ? 'Foto condivise ✓' : 'Video condivisi ✓';
        if (completed.size === 2) {
          showToast('Foto e video condivisi in due invii.');
          setTimeout(finish, 350);
        }
      } catch (error) {
        if (error?.name !== 'AbortError') {
          showToast(error?.message ?? 'Condivisione non riuscita.', { type: 'warning' });
        }
        button.disabled = false;
      }
    };

    photoButton.addEventListener('click', () => shareGroup(MEDIA_TYPES.PHOTO, photos, photoButton));
    videoButton.addEventListener('click', () => shareGroup(MEDIA_TYPES.VIDEO, videos, videoButton));
    closeButton.addEventListener('click', finish, { once: true });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish();
    }, { once: true });

    openDialog(dialog);
  });
}

async function shareSelection() {
  const items = galleryController.getSelectedItems();
  if (!items.length) return;
  const button = byId('selection-share');
  button.disabled = true;
  try {
    const { photos, videos } = partitionMediaByType(items);
    if (photos.length && videos.length) {
      await shareMixedSelection(photos, videos);
      return;
    }
    await shareMediaItems(items);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    if (items.length === 1 && ['SHARE_UNAVAILABLE', 'SHARE_FILES_UNSUPPORTED'].includes(error?.code)) {
      await downloadMedia(items[0]);
      showToast('Condivisione non disponibile: file salvato tramite download.', { type: 'warning' });
    } else {
      await showAlert({
        title: 'Condivisione non disponibile',
        message: error?.message ?? 'Il dispositivo non puo condividere questa selezione.',
      });
    }
  } finally {
    button.disabled = false;
  }
}

async function deleteSelection() {
  const selected = galleryController.getSelectedItems();
  if (!selected.length) return;
  const { allowed, denied } = splitMediaByDeletionPermission(currentUser, selected);
  if (!allowed.length) {
    showToast('Non hai il permesso di eliminare i media selezionati.', { type: 'warning' });
    return;
  }

  const centralItems = allowed.filter((media) => media.centralSynced === true || media.centralOnly === true);
  if (centralItems.length && !navigator.onLine) {
    showToast('Per eliminare file già sincronizzati serve una connessione Internet.', { type: 'warning' });
    return;
  }

  const deniedNotice = denied.length
    ? `
${denied.length} elementi non verranno eliminati perche non autorizzati.`
    : '';
  const confirmed = await confirmAction({
    title: 'Elimina definitivamente',
    message: `Eliminare definitivamente ${allowed.length} elementi dall'archivio aziendale? I file sincronizzati saranno rimossi anche da OneDrive e dagli altri dispositivi.${deniedNotice}`,
    confirmText: 'Elimina',
    danger: true,
  });
  if (!confirmed) return;

  setBusy(true, 'Eliminazione dall’archivio aziendale...');
  try {
    const result = await deleteMediaItems(currentUser, allowed.map((media) => media.id));
    galleryController.clearSelection();
    await galleryController.reload(filterController.getValue());
    if (result.deleted.length) {
      const skipped = result.denied.length + result.missing.length;
      const suffix = skipped ? ` ${skipped} non erano piu eliminabili.` : '';
      showToast(`${result.deleted.length} elementi eliminati.${suffix}`, { type: 'success' });
    } else {
      showToast('Nessun elemento era ancora eliminabile.', { type: 'warning' });
    }
  } catch (error) {
    const partialCount = error?.deletionResult?.deleted?.length ?? 0;
    galleryController.clearSelection();
    await galleryController.reload(filterController.getValue());
    const prefix = partialCount ? `${partialCount} elementi eliminati prima dell'interruzione. ` : '';
    showToast(`${prefix}${error?.message ?? 'Eliminazione non riuscita.'}`, {
      type: 'error',
      duration: 6000,
    });
  } finally {
    setBusy(false);
  }
}

async function handleLogout() {
  closeDialog(byId('menu-dialog'));
  if (byId('viewer-dialog').open) viewerController.close();
  galleryController.clearSelection();
  filterController.clearSite();
  try {
    await logoutCentralUser();
  } catch (error) {
    showToast(error?.message ?? 'Uscita non riuscita.', { type: 'error' });
    return;
  }
  currentUser = null;
  clearTimeout(mediaSyncTimer);
  mediaSyncTimer = null;
  sitesCache = [];
  usersCache = [];
  byId('upload-site-select').value = '';
  updateUploadHomeFeedback();
  await showCentralAuthScreen();
}

function createTextElement(tag, text, className = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function actionButton(label, onClick, { danger = false } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `button button-text${danger ? ' danger-text' : ''}`;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

async function openSitesManagement() {
  closeDialog(byId('menu-dialog'));
  await renderSitesManagement();
  openDialog(byId('sites-dialog'));
}

async function renderSitesManagement() {
  const list = byId('sites-list');
  list.replaceChildren();
  const sites = await listSites({ includeDeleting: true });
  if (!sites.length) {
    list.append(createTextElement('p', 'Nessun cantiere configurato.', 'muted'));
    return;
  }

  for (const site of sites) {
    const card = document.createElement('article');
    card.className = 'management-card';
    card.append(createTextElement('h3', site.name));
    if (site.client) card.append(createTextElement('p', `Cliente: ${site.client}`));
    if (site.address) card.append(createTextElement('p', site.address));
    const statusLabel = site.status === SITE_STATUSES.ACTIVE
      ? 'Attivo'
      : site.status === SITE_STATUSES.COMPLETED
        ? 'Concluso'
        : 'Eliminazione in corso';
    card.append(createTextElement('span', statusLabel, 'status-chip'));

    const actions = document.createElement('div');
    actions.className = 'management-card-actions';
    if (site.status !== SITE_STATUSES.DELETING) {
      actions.append(
        actionButton('Modifica', () => openSiteEditor(site)),
        actionButton('Elimina', () => confirmSiteDeletion(site), { danger: true }),
      );
    }
    card.append(actions);
    list.append(card);
  }
}

function openSiteEditor(site = null) {
  byId('site-editor-title').textContent = site ? 'Modifica cantiere' : 'Nuovo cantiere';
  byId('site-editor-id').value = site?.id ?? '';
  byId('site-name').value = site?.name ?? '';
  byId('site-client').value = site?.client ?? '';
  byId('site-address').value = site?.address ?? '';
  byId('site-status').value = site?.status === SITE_STATUSES.COMPLETED
    ? SITE_STATUSES.COMPLETED
    : SITE_STATUSES.ACTIVE;
  openDialog(byId('site-editor-dialog'));
  setTimeout(() => byId('site-name').focus(), 0);
}

function closeSiteEditor() {
  closeDialog(byId('site-editor-dialog'));
}

async function saveSiteEditor(event) {
  event.preventDefault();
  const id = byId('site-editor-id').value;
  const data = {
    name: byId('site-name').value,
    client: byId('site-client').value,
    address: byId('site-address').value,
    status: byId('site-status').value,
  };
  const submit = submitButtonFor(event);
  if (submit) submit.disabled = true;
  try {
    const savedSite = id
      ? await updateSite(currentUser, id, data)
      : await createSite(currentUser, data);
    closeSiteEditor();
    await refreshMetadata();
    await renderSitesManagement();
    const pending = savedSite?.syncState && savedSite.syncState !== 'synced';
    showToast(
      pending
        ? `${id ? 'Cantiere aggiornato' : 'Cantiere creato'} sul dispositivo. Sincronizzazione in attesa.`
        : `${id ? 'Cantiere aggiornato' : 'Cantiere creato'}.`,
      { type: pending ? 'warning' : 'success', duration: pending ? 5000 : 3000 },
    );
  } catch (error) {
    showToast(error?.message ?? 'Salvataggio non riuscito.', { type: 'error' });
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function confirmSiteDeletion(site) {
  const wasSelected = filterController.getValue().siteId === site.id;
  try {
    const mediaCount = await getSiteMediaCount(site.id);
    const warning = mediaCount
      ? `Il cantiere contiene ${mediaCount} media locali. Verranno rimossi dal dispositivo anche file, miniature e preferiti collegati. Le copie gia caricate su OneDrive resteranno archiviate.`
      : 'Il cantiere non contiene media locali. L eventuale cartella OneDrive restera archiviata.';
    const first = await confirmAction({
      title: 'Elimina cantiere',
      message: `${warning}\nQuesta operazione non puo essere annullata.`,
      confirmText: 'Continua',
      danger: true,
    });
    if (!first) return;

    const second = await confirmAction({
      title: 'Seconda conferma',
      message: 'Scrivi esattamente il nome del cantiere per confermare.',
      confirmText: 'Elimina definitivamente',
      danger: true,
      requiredText: site.name,
      inputLabel: `Nome cantiere: ${site.name}`,
    });
    if (!second) return;

    setBusy(true, 'Preparazione eliminazione...');
    const result = await deleteSiteInBatches(currentUser, site.id, ({ deletedMedia }) => {
      byId('busy-message').textContent = `Eliminazione: ${deletedMedia} media rimossi...`;
    }, { expectedUpdatedAt: site.updatedAt });
    await refreshMetadata();
    await renderSitesManagement();
    if (wasSelected) filterController.clearSite();
    showToast(
      result.syncPending
        ? `Cantiere rimosso dal dispositivo. Media rimossi: ${result.deletedMedia}. Eliminazione centrale in attesa.`
        : `Cantiere eliminato. Media rimossi: ${result.deletedMedia}.`,
      { type: result.syncPending ? 'warning' : 'success', duration: 5000 },
    );
  } catch (error) {
    showToast(error?.message ?? 'Eliminazione del cantiere non riuscita.', { type: 'error' });
  } finally {
    setBusy(false);
  }
}

async function resumeInterruptedDeletions() {
  if (!isAdministrator(currentUser)) return;
  const actor = currentUser;
  const actorId = actor.id;
  setTimeout(async () => {
    let active = false;
    try {
      await resumePendingSiteDeletions(actor, ({ site, deletedMedia }) => {
        if (!active) {
          active = true;
          setBusy(true, `Ripresa eliminazione di ${site.name}...`);
        }
        byId('busy-message').textContent = `${site.name}: ${deletedMedia} media rimossi...`;
      });
      if (currentUser?.id === actorId) await refreshMetadata();
    } catch (error) {
      showToast(error?.message ?? 'Ripresa eliminazione non riuscita.', { type: 'error' });
    } finally {
      if (active) setBusy(false);
    }
  }, 600);
}

async function openUsersManagement() {
  closeDialog(byId('menu-dialog'));
  await renderUsersManagement();
  openDialog(byId('users-dialog'));
}

async function renderUsersManagement() {
  const list = byId('users-list');
  list.replaceChildren();
  usersCache = await listUsers();
  for (const user of usersCache) {
    const card = document.createElement('article');
    card.className = 'management-card';
    const selfSuffix = user.id === currentUser.id ? ' (tu)' : '';
    card.append(createTextElement('h3', `${user.name}${selfSuffix}`));
    card.append(createTextElement('p', user.role === ROLES.ADMIN ? 'Amministratore' : 'Utente'));
    const chip = createTextElement(
      'span',
      user.active === false ? 'Disattivato' : 'Attivo',
      `status-chip${user.active === false ? ' is-inactive' : ''}`,
    );
    card.append(chip);
    const actions = document.createElement('div');
    actions.className = 'management-card-actions';
    actions.append(actionButton('Modifica', () => openUserEditor(user)));
    card.append(actions);
    list.append(card);
  }
}

function openUserEditor(user = null) {
  userEditorOriginal = user;
  const isSelf = user?.id === currentUser.id;
  byId('user-editor-title').textContent = user ? 'Modifica utente' : 'Nuovo utente';
  byId('user-editor-id').value = user?.id ?? '';
  byId('user-name').value = user?.name ?? '';
  byId('user-role').value = user?.role ?? ROLES.USER;
  byId('user-role').disabled = Boolean(isSelf);
  byId('user-pin').value = '';
  byId('user-pin').required = !user;
  byId('user-pin-label').textContent = user ? 'Nuovo PIN (opzionale)' : 'PIN';
  byId('user-active-field').hidden = !user;
  byId('user-active').checked = user?.active !== false;
  byId('user-active').disabled = Boolean(isSelf);
  openDialog(byId('user-editor-dialog'));
  setTimeout(() => byId('user-name').focus(), 0);
}

function closeUserEditor() {
  userEditorOriginal = null;
  closeDialog(byId('user-editor-dialog'));
}

async function saveUserEditor(event) {
  event.preventDefault();
  const id = byId('user-editor-id').value;
  const pin = byId('user-pin').value;
  const data = {
    name: byId('user-name').value,
    role: userEditorOriginal?.id === currentUser.id
      ? userEditorOriginal.role
      : byId('user-role').value,
    active: userEditorOriginal?.id === currentUser.id
      ? userEditorOriginal.active
      : byId('user-active').checked,
  };
  if (pin) data.pin = pin;

  const submit = submitButtonFor(event);
  if (submit) submit.disabled = true;
  try {
    let saved;
    if (id) saved = await updateUser(currentUser, id, data);
    else saved = await createUser(currentUser, { ...data, pin });

    if (saved.id === currentUser.id) {
      currentUser = saved;
      updateCurrentUserSnapshot(saved);
      updateCurrentUserUi();
    }
    closeUserEditor();
    await refreshMetadata();
    await renderUsersManagement();
    showToast(id ? 'Utente aggiornato.' : 'Utente creato.', { type: 'success' });
  } catch (error) {
    showToast(error?.message ?? 'Salvataggio utente non riuscito.', { type: 'error' });
  } finally {
    if (submit) submit.disabled = false;
  }
}

function updateConnectionStatus() {
  byId('connection-status').textContent = navigator.onLine ? '' : 'Offline - dati locali';
}

async function updateMenuStorage() {
  const element = byId('storage-summary');
  try {
    const [estimate, counts, persistent, mediaSync] = await Promise.all([
      getStorageEstimate(),
      getStorageCounts(),
      navigator.storage?.persisted?.() ?? Promise.resolve(false),
      getMediaSyncSummary(),
    ]);
    const space = estimate?.quota
      ? `${formatBytes(estimate.usage)} di ${formatBytes(estimate.quota)}`
      : 'quota non disponibile';
    const pending = mediaSync.pending ? ` - ${mediaSync.pending} in attesa OneDrive` : '';
    element.textContent = `Spazio: ${space} - ${counts.media} media${pending} - ${persistent ? 'persistente' : 'standard'}`;
  } catch {
    element.textContent = 'Spazio: informazioni non disponibili';
  }
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function updateInstallButton() {
  byId('install-app-button').hidden = isStandalone();
}

async function installApplication() {
  closeDialog(byId('menu-dialog'));
  if (deferredInstallPrompt) {
    await deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    updateInstallButton();
    return;
  }
  await showAlert({
    title: 'Installa Cantiere Media',
    message: 'Apri il menu di condivisione del browser e scegli "Aggiungi alla schermata Home" oppure "Installa app".',
  });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!window.isSecureContext && location.hostname !== 'localhost') return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !refreshing) {
      refreshing = true;
      location.reload();
    }
  });
  try {
    const registration = await navigator.serviceWorker.register(`./service-worker.js?v=${encodeURIComponent(APP_VERSION)}`, { scope: './', updateViaCache: 'none' });
    const announceWaitingUpdate = () => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        showToast('Aggiornamento pronto: applicazione in riavvio.', {
          type: 'success',
          duration: 6000,
        });
      }
    };
    announceWaitingUpdate();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') announceWaitingUpdate();
      });
    });
    registration.update().catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {});
    });
  } catch (error) {
    console.error('Service worker registration failed.', error);
  }
}

start();
