import {
  APP_VERSION,
  MEDIA_TYPES,
  ROLES,
  SITE_STATUSES,
  VIEW_MODES,
} from './config.js?v=1.0.4';
import {
  bootstrapAdministrator,
  login,
  logout,
  updateCurrentUserSnapshot,
} from './auth.js?v=1.0.4';
import {
  getStorageCounts,
  openDatabase,
} from './db.js?v=1.0.4';
import { FilterController, isFavoriteView, viewModeLabel } from './filters.js?v=1.0.4';
import { GalleryController } from './gallery.js?v=1.0.4';
import {
  downloadMedia,
  deleteMediaItems,
  getStorageEstimate,
  partitionMediaByType,
  shareMediaItems,
} from './media.js?v=1.0.4';
import { isAdministrator, splitMediaByDeletionPermission } from './permissions.js?v=1.0.4';
import {
  createSite,
  deleteSiteInBatches,
  getSiteMediaCount,
  listSites,
  resumePendingSiteDeletions,
  updateSite,
} from './sites.js?v=1.0.4';
import { UploadController } from './upload.js?v=1.0.4';
import {
  createUser,
  listUsers,
  updateUser,
} from './users.js?v=1.0.4';
import {
  byId,
  closeDialog,
  confirmAction,
  openDialog,
  setBusy,
  showAlert,
  showToast,
} from './ui.js?v=1.0.4';
import { debounce, formatBytes } from './utils.js?v=1.0.4';
import { ViewerController } from './viewer.js?v=1.0.4';

let currentUser = null;
let sitesCache = [];
let usersCache = [];
let currentView = VIEW_MODES.ARCHIVE;
let deferredInstallPrompt = null;
let filterController;
let galleryController;
let uploadController;
let viewerController;
let userEditorOriginal = null;

const reloadGallery = debounce((filters) => {
  if (currentUser) galleryController.reload(filters);
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
  return sitesCache.find((site) => site.id === siteId) ?? null;
}

function initializeControllers() {
  filterController = new FilterController({
    siteSelect: byId('site-filter'),
    mediaSelect: byId('media-filter'),
    authorSelect: byId('author-filter'),
    dateInput: byId('date-filter'),
    onChange: reloadGallery,
  });

  galleryController = new GalleryController({
    container: byId('gallery'),
    status: byId('gallery-status'),
    sentinel: byId('gallery-sentinel'),
    getUser: () => currentUser,
    onOpen: (index) => viewerController.open(index),
    onSelectionChange: updateSelectionToolbar,
  });

  viewerController = new ViewerController({
    dialog: byId('viewer-dialog'),
    stage: byId('viewer-stage'),
    transform: byId('viewer-transform'),
    closeButton: byId('viewer-close'),
    shareButton: byId('viewer-share'),
    favoriteButton: byId('viewer-favorite'),
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
    getUser: () => currentUser,
    getViewMode: () => currentView,
    onClose: ({ favoriteChanged }) => {
      if (favoriteChanged && isFavoriteView(currentView)) {
        galleryController.reload(filterController.getValue());
      }
    },
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
    getContext: () => ({ site: activeSite(), user: currentUser }),
    onUploaded: async () => galleryController.reload(filterController.getValue()),
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
  byId('upload-fab').addEventListener('click', () => uploadController.open());
  byId('selection-close').addEventListener('click', () => galleryController.clearSelection());
  byId('selection-share').addEventListener('click', shareSelection);
  byId('selection-delete').addEventListener('click', deleteSelection);
  byId('logout-button').addEventListener('click', handleLogout);
  byId('manage-sites-button').addEventListener('click', openSitesManagement);
  byId('manage-users-button').addEventListener('click', openUsersManagement);
  byId('install-app-button').addEventListener('click', installApplication);

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
  setView(VIEW_MODES.ARCHIVE, { closeMenu: false });
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
  [usersCache, sitesCache] = await Promise.all([
    listUsers(),
    listSites(),
  ]);
  filterController.setUsers(usersCache);
  filterController.setSites(sitesCache, selectedSiteId);
}

function setView(viewMode, { closeMenu = true } = {}) {
  if (!Object.values(VIEW_MODES).includes(viewMode)) return;
  currentView = viewMode;
  byId('view-title').textContent = viewModeLabel(viewMode);
  for (const button of document.querySelectorAll('[data-view]')) {
    button.classList.toggle('is-active', button.dataset.view === viewMode);
  }
  filterController.setViewMode(viewMode, currentUser);
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
