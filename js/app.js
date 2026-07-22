import {
  ALL_SITES_ID,
  APP_VERSION,
  MEDIA_TYPES,
  ROLES,
  SITE_STATUSES,
  VIEW_MODES,
} from './config.js?v=1.3.0';
import {
  bootstrapAdministrator,
  login,
  logout,
  updateCurrentUserSnapshot,
} from './auth.js?v=1.3.0';
import {
  getStorageCounts,
  openDatabase,
} from './db.js?v=1.3.0';
import { FilterController, viewModeLabel } from './filters.js?v=1.3.0';
import { GalleryController } from './gallery.js?v=1.3.0';
import {
  getSiteFavoriteIds,
  SITE_FAVORITE_CONTEXTS,
  sortSitesByFavorites,
  toggleSiteFavorite,
} from './site-favorites.js?v=1.3.0';
import { SitePickerController } from './site-picker.js?v=1.3.0';
import {
  downloadMedia,
  deleteMediaItems,
  getStorageEstimate,
  partitionMediaByType,
  shareMediaItems,
} from './media.js?v=1.3.0';
import { isAdministrator, splitMediaByDeletionPermission } from './permissions.js?v=1.3.0';
import {
  createSite,
  deleteSiteInBatches,
  getSiteMediaCount,
  listSites,
  resumePendingSiteDeletions,
  updateSite,
} from './sites.js?v=1.3.0';
import { UploadController } from './upload.js?v=1.3.0';
import {
  createUser,
  listUsers,
  updateUser,
} from './users.js?v=1.3.0';
import {
  byId,
  closeDialog,
  confirmAction,
  openDialog,
  setBusy,
  showAlert,
  showToast,
} from './ui.js?v=1.3.0';
import { debounce, formatBytes } from './utils.js?v=1.3.0';
import { ViewerController } from './viewer.js?v=1.3.0';

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
  });

  viewerController = new ViewerController({
    dialog: byId('viewer-dialog'),
    stage: byId('viewer-stage'),
    transform: byId('viewer-transform'),
    closeButton: byId('viewer-close'),
    shareButton: byId('viewer-share'),
    position: byId('viewer-position'),
    caption: byId('viewer-caption'),
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
      if (currentView !== VIEW_MODES.UPLOAD) {
        await galleryController.reload(filterController.getValue());
      }
    },
  });
}

function bindStaticEvents() {
  byId('setup-form').addEventListener('submit', handleSetup);
  byId('login-form').addEventListener('submit', handleLogin);
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

  window.addEventListener('online', updateConnectionStatus);
  window.addEventListener('offline', updateConnectionStatus);
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
  registerServiceWorker();

  try {
    await openDatabase();
    const users = await listUsers();
    if (!users.length) showSetupScreen();
    else await showLoginScreen(users);
  } catch (error) {
    showAuthError(error?.message ?? 'Impossibile avviare l\'applicazione.');
  }
}

function showSetupScreen() {
  byId('setup-form').hidden = false;
  byId('login-form').hidden = true;
  byId('app-screen').hidden = true;
  byId('auth-screen').hidden = false;
  setTimeout(() => byId('setup-name').focus(), 0);
}

async function showLoginScreen(users = null) {
  const availableUsers = (users ?? await listUsers({ activeOnly: true }))
    .filter((user) => user.active !== false);
  const select = byId('login-user');
  select.replaceChildren();
  for (const user of availableUsers) select.add(new Option(user.name, user.id));
  const lastUserId = localStorage.getItem('last-user-id');
  if (availableUsers.some((user) => user.id === lastUserId)) select.value = lastUserId;
  byId('login-pin').value = '';
  byId('setup-form').hidden = true;
  byId('login-form').hidden = false;
  byId('app-screen').hidden = true;
  byId('auth-screen').hidden = false;
  showAuthError('');
  setTimeout(() => byId('login-pin').focus(), 0);
}

async function handleSetup(event) {
  event.preventDefault();
  showAuthError('');
  const name = byId('setup-name').value;
  const pin = byId('setup-pin').value;
  const confirmation = byId('setup-pin-confirm').value;
  if (pin !== confirmation) {
    showAuthError('I PIN non coincidono.');
    return;
  }
  const submit = submitButtonFor(event);
  if (submit) submit.disabled = true;
  try {
    const user = await bootstrapAdministrator(name, pin);
    await enterApplication(user);
  } catch (error) {
    if (error?.code === 'SETUP_ALREADY_COMPLETED') {
      await showLoginScreen();
      showAuthError('Configurazione gia completata in un\'altra finestra. Accedi con il tuo utente.');
      return;
    }
    showAuthError(error?.message ?? 'Creazione non riuscita.');
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function handleLogin(event) {
  event.preventDefault();
  showAuthError('');
  const submit = submitButtonFor(event);
  if (submit) submit.disabled = true;
  try {
    const userId = byId('login-user').value;
    const user = await login(userId, byId('login-pin').value);
    localStorage.setItem('last-user-id', user.id);
    await enterApplication(user);
  } catch (error) {
    showAuthError(error?.message ?? 'Accesso non riuscito.');
    byId('login-pin').select();
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function enterApplication(user) {
  currentUser = user;
  byId('auth-screen').hidden = true;
  byId('app-screen').hidden = false;
  updateCurrentUserUi();
  await refreshMetadata();
  setView(VIEW_MODES.UPLOAD, { closeMenu: false });
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
}

async function refreshMetadata() {
  const selectedSiteId = filterController?.getValue().siteId;
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

  const deniedNotice = denied.length
    ? `\n${denied.length} elementi non verranno eliminati perche non autorizzati.`
    : '';
  const confirmed = await confirmAction({
    title: 'Elimina media',
    message: `Eliminare definitivamente ${allowed.length} elementi?${deniedNotice}`,
    confirmText: 'Elimina',
    danger: true,
  });
  if (!confirmed) return;

  setBusy(true, 'Eliminazione media...');
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
  logout();
  currentUser = null;
  sitesCache = [];
  usersCache = [];
  byId('upload-site-select').value = '';
  updateUploadHomeFeedback();
  await showLoginScreen();
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
    if (id) await updateSite(currentUser, id, data);
    else await createSite(currentUser, data);
    closeSiteEditor();
    await refreshMetadata();
    await renderSitesManagement();
    showToast(id ? 'Cantiere aggiornato.' : 'Cantiere creato.', { type: 'success' });
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
      ? `Il cantiere contiene ${mediaCount} media. Verranno eliminati anche file, miniature e preferiti collegati.`
      : 'Il cantiere non contiene media.';
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
      `Cantiere eliminato. Media rimossi: ${result.deletedMedia}.`,
      { type: 'success', duration: 5000 },
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
    const [estimate, counts, persistent] = await Promise.all([
      getStorageEstimate(),
      getStorageCounts(),
      navigator.storage?.persisted?.() ?? Promise.resolve(false),
    ]);
    const space = estimate?.quota
      ? `${formatBytes(estimate.usage)} di ${formatBytes(estimate.quota)}`
      : 'quota non disponibile';
    element.textContent = `Spazio: ${space} - ${counts.media} media - ${persistent ? 'persistente' : 'standard'}`;
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
