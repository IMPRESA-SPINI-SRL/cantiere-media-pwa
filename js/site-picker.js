import { ALL_SITES_ID, SITE_STATUSES } from './config.js?v=1.7.0';
import { groupSitesForPicker } from './site-favorites.js?v=1.7.0';
import { closeDialog, openDialog } from './ui.js?v=1.7.0';

function createStarIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#icon-star');
  svg.append(use);
  return svg;
}

function siteLabel(site) {
  return site.status === SITE_STATUSES.COMPLETED
    ? `${site.name} (concluso)`
    : site.name;
}

export function wheelDeltaPixels(deltaY, deltaMode = 0, viewportHeight = 0) {
  if (deltaMode === 1) return deltaY * 18;
  if (deltaMode === 2) return deltaY * Math.max(1, viewportHeight);
  return deltaY;
}

export class SitePickerController {
  constructor({ dialog, title, list, closeButton }) {
    Object.assign(this, { dialog, title, list, closeButton });
    this.context = null;
    this.sites = [];
    this.favoriteIds = new Set();
    this.selectedId = '';
    this.allowAllSites = false;
    this.onSelect = null;
    this.onToggleFavorite = null;

    this.closeButton.addEventListener('click', () => closeDialog(this.dialog));
    this.list.addEventListener('wheel', (event) => this.handleWheel(event), { passive: false });
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeDialog(this.dialog);
    });
  }

  open({
    title,
    context,
    sites,
    favoriteIds,
    selectedId,
    allowAllSites = false,
    onSelect,
    onToggleFavorite,
  }) {
    this.title.textContent = title;
    this.context = context;
    this.sites = [...sites];
    this.favoriteIds = new Set(favoriteIds ?? []);
    this.selectedId = selectedId ?? '';
    this.allowAllSites = allowAllSites;
    this.onSelect = onSelect;
    this.onToggleFavorite = onToggleFavorite;
    this.render();
    openDialog(this.dialog);
  }

  handleWheel(event) {
    const maxScrollTop = Math.max(0, this.list.scrollHeight - this.list.clientHeight);
    if (maxScrollTop === 0 || event.deltaY === 0) return;

    const delta = wheelDeltaPixels(event.deltaY, event.deltaMode, this.list.clientHeight);
    const nextScrollTop = Math.min(maxScrollTop, Math.max(0, this.list.scrollTop + delta));
    if (nextScrollTop === this.list.scrollTop) return;

    this.list.scrollTop = nextScrollTop;
    event.preventDefault();
    event.stopPropagation();
  }

  render() {
    this.list.replaceChildren();
    this.list.append(this.createClearRow());
    if (this.allowAllSites) this.list.append(this.createAllSitesRow());

    const groups = groupSitesForPicker(this.sites, this.favoriteIds);
    if (groups.favorites.length) this.appendGroup('Preferiti', groups.favorites);
    if (groups.active.length) this.appendGroup('Cantieri attivi', groups.active);
    if (groups.completed.length) this.appendGroup('Cantieri conclusi', groups.completed);

    if (!this.sites.length) {
      const empty = document.createElement('p');
      empty.className = 'site-picker-empty';
      empty.textContent = 'Nessun cantiere disponibile.';
      this.list.append(empty);
    }
  }

  createClearRow() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `site-picker-clear${this.selectedId ? '' : ' is-selected'}`;
    button.textContent = 'Seleziona un cantiere...';
    button.addEventListener('click', () => this.selectSite(''));
    return button;
  }

  createAllSitesRow() {
    const button = document.createElement('button');
    button.type = 'button';
    const selected = this.selectedId === ALL_SITES_ID;
    button.className = `site-picker-all${selected ? ' is-selected' : ''}`;
    button.setAttribute('aria-pressed', String(selected));
    button.innerHTML = `<span class="site-picker-all-check" aria-hidden="true">${selected ? '✓' : ''}</span><span>Tutti i cantieri</span>`;
    button.addEventListener('click', () => this.selectSite(ALL_SITES_ID));
    return button;
  }

  appendGroup(label, sites) {
    const heading = document.createElement('h3');
    heading.className = 'site-picker-group-title';
    heading.textContent = label;
    this.list.append(heading);
    for (const site of sites) this.list.append(this.createSiteRow(site));
  }

  createSiteRow(site) {
    const row = document.createElement('div');
    row.className = `site-picker-row${site.id === this.selectedId ? ' is-selected' : ''}`;

    const selectButton = document.createElement('button');
    selectButton.type = 'button';
    selectButton.className = 'site-picker-site';
    selectButton.textContent = siteLabel(site);
    selectButton.setAttribute('aria-current', site.id === this.selectedId ? 'true' : 'false');
    selectButton.addEventListener('click', () => this.selectSite(site.id));

    const favorite = this.favoriteIds.has(site.id);
    const starButton = document.createElement('button');
    starButton.type = 'button';
    starButton.className = `site-picker-star${favorite ? ' is-favorite' : ''}`;
    starButton.setAttribute('aria-pressed', String(favorite));
    starButton.setAttribute(
      'aria-label',
      favorite ? `Rimuovi ${site.name} dai preferiti` : `Aggiungi ${site.name} ai preferiti`,
    );
    starButton.title = favorite ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti';
    starButton.append(createStarIcon());
    starButton.addEventListener('click', async () => {
      starButton.disabled = true;
      try {
        const result = await this.onToggleFavorite?.(site.id, this.context);
        if (!result) return;
        if (result.ids) this.favoriteIds = new Set(result.ids);
        else if (favorite) this.favoriteIds.delete(site.id);
        else this.favoriteIds.add(site.id);
        this.render();
      } finally {
        starButton.disabled = false;
      }
    });

    row.append(selectButton, starButton);
    return row;
  }

  selectSite(siteId) {
    this.selectedId = siteId;
    this.onSelect?.(siteId, this.context);
    closeDialog(this.dialog);
  }
}
