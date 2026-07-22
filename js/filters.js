import { ALL_SITES_ID, MEDIA_FILTERS, SITE_STATUSES, VIEW_MODES } from './config.js?v=1.4.3';

export function viewModeLabel(viewMode) {
  return viewMode === VIEW_MODES.ARCHIVE ? 'Archivio' : 'Carica';
}

export class FilterController {
  constructor({ siteSelect, mediaSelect, authorSelect, dateInput, onChange }) {
    this.siteSelect = siteSelect;
    this.mediaSelect = mediaSelect;
    this.authorSelect = authorSelect;
    this.dateInput = dateInput;
    this.onChange = onChange;
    this.viewMode = VIEW_MODES.ARCHIVE;

    this.mediaSelect.value = MEDIA_FILTERS.PHOTO;
    for (const control of [siteSelect, mediaSelect, authorSelect, dateInput]) {
      control.addEventListener('change', () => this.onChange?.(this.getValue()));
    }
  }

  setSites(sites, selectedId = this.siteSelect.value) {
    this.siteSelect.replaceChildren(
      new Option('Seleziona un cantiere...', ''),
      new Option('Tutti i cantieri', ALL_SITES_ID),
    );
    for (const site of sites) {
      const suffix = site.status === SITE_STATUSES.COMPLETED ? ' (concluso)' : '';
      this.siteSelect.add(new Option(`${site.name}${suffix}`, site.id));
    }
    const valid = selectedId === ALL_SITES_ID || sites.some((site) => site.id === selectedId);
    this.siteSelect.value = valid ? selectedId : '';
  }

  setUsers(users, selectedId = this.authorSelect.value || 'all') {
    this.authorSelect.replaceChildren(new Option('Tutti', 'all'));
    for (const user of users) {
      const suffix = user.active === false ? ' (disattivato)' : '';
      this.authorSelect.add(new Option(`${user.name}${suffix}`, user.id));
    }
    this.authorSelect.value = users.some((user) => user.id === selectedId) ? selectedId : 'all';
  }

  setViewMode(viewMode) {
    this.viewMode = viewMode;
    this.onChange?.(this.getValue());
  }

  getValue() {
    return {
      siteId: this.siteSelect.value || null,
      mediaType: this.mediaSelect.value || MEDIA_FILTERS.PHOTO,
      authorId: this.authorSelect.value || 'all',
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
