import {
  MEDIA_FILTERS,
  SITE_STATUSES,
  VIEW_MODES,
} from './config.js?v=1.1.0';

export function isFavoriteView(viewMode) {
  return [VIEW_MODES.FAVORITE_ARCHIVE, VIEW_MODES.FAVORITE_UPLOADS].includes(viewMode);
}

export function isUploadView(viewMode) {
  return [VIEW_MODES.MY_UPLOADS, VIEW_MODES.FAVORITE_UPLOADS].includes(viewMode);
}

export function viewModeLabel(viewMode) {
  const labels = {
    [VIEW_MODES.UPLOAD]: 'Carica',
    [VIEW_MODES.ARCHIVE]: 'Archivio',
    [VIEW_MODES.MY_UPLOADS]: 'I miei upload',
    [VIEW_MODES.FAVORITE_ARCHIVE]: 'Preferiti archivio',
    [VIEW_MODES.FAVORITE_UPLOADS]: 'Preferiti upload',
  };
  return labels[viewMode] ?? labels[VIEW_MODES.UPLOAD];
}

export class FilterController {
  constructor({ siteSelect, mediaSelect, authorSelect, dateInput, onChange }) {
    this.siteSelect = siteSelect;
    this.mediaSelect = mediaSelect;
    this.authorSelect = authorSelect;
    this.dateInput = dateInput;
    this.onChange = onChange;
    this.viewMode = VIEW_MODES.ARCHIVE;
    this.currentUser = null;

    this.mediaSelect.value = MEDIA_FILTERS.PHOTO;
    for (const control of [siteSelect, mediaSelect, authorSelect, dateInput]) {
      control.addEventListener('change', () => this.onChange?.(this.getValue()));
    }
  }

  setSites(sites, selectedId = this.siteSelect.value) {
    this.siteSelect.replaceChildren(new Option('Seleziona un cantiere...', ''));
    for (const site of sites) {
      const suffix = site.status === SITE_STATUSES.COMPLETED ? ' (concluso)' : '';
      this.siteSelect.add(new Option(`${site.name}${suffix}`, site.id));
    }
    this.siteSelect.value = sites.some((site) => site.id === selectedId) ? selectedId : '';
  }

  setUsers(users, selectedId = this.authorSelect.value || 'all') {
    this.authorSelect.replaceChildren(new Option('Tutti', 'all'));
    for (const user of users) {
      const suffix = user.active === false ? ' (disattivato)' : '';
      this.authorSelect.add(new Option(`${user.name}${suffix}`, user.id));
    }
    this.authorSelect.value = users.some((user) => user.id === selectedId) ? selectedId : 'all';
    this.applyModeConstraints();
  }

  setViewMode(viewMode, currentUser) {
    this.viewMode = viewMode;
    this.currentUser = currentUser;
    this.applyModeConstraints();
    this.onChange?.(this.getValue());
  }

  applyModeConstraints() {
    const uploadMode = isUploadView(this.viewMode);
    this.authorSelect.disabled = uploadMode;
    if (uploadMode && this.currentUser) {
      this.authorSelect.value = this.currentUser.id;
    }
  }

  getValue() {
    return {
      siteId: this.siteSelect.value || null,
      mediaType: this.mediaSelect.value || MEDIA_FILTERS.PHOTO,
      authorId: isUploadView(this.viewMode) && this.currentUser
        ? this.currentUser.id
        : (this.authorSelect.value || 'all'),
      date: this.dateInput.value || null,
      viewMode: this.viewMode,
    };
  }

  setSite(siteId, { notify = true } = {}) {
    const value = siteId && [...this.siteSelect.options].some((option) => option.value === siteId)
      ? siteId
      : '';
    this.siteSelect.value = value;
    if (notify) this.onChange?.(this.getValue());
  }

  clearSite() {
    this.setSite('');
  }
}
