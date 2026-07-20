import { LIMITS, MEDIA_TYPES } from './config.js?v=1.0.4';
import { queryMediaPage } from './db.js?v=1.0.4';
import { favoriteContextForView, queryFavorites } from './favorites.js?v=1.0.4';
import { isFavoriteView } from './filters.js?v=1.0.4';
import { getOrCreateThumbnail, mediaDescription } from './media.js?v=1.0.4';

const LONG_PRESS_MS = 480;
const MOVE_TOLERANCE = 12;
const VIRTUALIZE_AFTER_ITEMS = 240;
const WINDOW_ROWS = 84;
const WINDOW_CHUNK_ROWS = 18;
const OVERSCAN_ROWS = 24;

export function computeGalleryWindow({
  itemCount,
  columns,
  visibleStartRow,
  visibleRows,
}) {
  const safeCount = Math.max(0, Math.floor(itemCount));
  const safeColumns = Math.max(1, Math.floor(columns));
  const totalRows = Math.ceil(safeCount / safeColumns);
  if (!safeCount || safeCount <= VIRTUALIZE_AFTER_ITEMS || totalRows <= WINDOW_ROWS) {
    return {
      startIndex: 0,
      endIndex: safeCount,
      startRow: 0,
      endRow: totalRows,
      totalRows,
    };
  }

  const firstVisibleRow = Math.max(0, Math.min(totalRows - 1, Math.floor(visibleStartRow)));
  const rowsOnScreen = Math.max(1, Math.ceil(visibleRows));
  const rawStart = Math.max(0, firstVisibleRow - OVERSCAN_ROWS);
  const startRow = Math.floor(rawStart / WINDOW_CHUNK_ROWS) * WINDOW_CHUNK_ROWS;
  const requiredEnd = firstVisibleRow + rowsOnScreen + OVERSCAN_ROWS;
  const endRow = Math.min(totalRows, Math.max(startRow + WINDOW_ROWS, requiredEnd));

  return {
    startIndex: startRow * safeColumns,
    endIndex: Math.min(safeCount, endRow * safeColumns),
    startRow,
    endRow,
    totalRows,
  };
}

export class GalleryController {
  constructor({
    container,
    status,
    sentinel,
    getUser,
    onOpen,
    onSelectionChange,
  }) {
    Object.assign(this, {
      container,
      status,
      sentinel,
      getUser,
      onOpen,
      onSelectionChange,
    });
    this.items = [];
    this.itemById = new Map();
    this.selectedIds = new Set();
    this.nextCursor = null;
    this.hasMore = false;
    this.loadedOnce = false;
    this.loadingPromise = null;
    this.filters = null;
    this.loadToken = 0;
    this.objectUrls = new Set();
    this.renderFrame = null;
    this.forceNextRender = false;
    this.renderSignature = '';

    this.thumbnailObserver = new IntersectionObserver(
      (entries) => this.handleThumbnailIntersections(entries),
      { rootMargin: '500px 0px' },
    );
    this.sentinelObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) this.loadNextPage();
      },
      { rootMargin: '900px 0px' },
    );
    this.sentinelObserver.observe(this.sentinel);

    this.handleViewportChange = () => this.scheduleRenderWindow();
    window.addEventListener('scroll', this.handleViewportChange, { passive: true });
    window.addEventListener('resize', this.handleViewportChange, { passive: true });
  }

  getItems() {
    return this.items;
  }

  hasMoreItems() {
    return this.hasMore;
  }

  getSelectedItems() {
    return this.items.filter((item) => this.selectedIds.has(item.id));
  }

  async reload(filters) {
    this.loadToken += 1;
    this.filters = { ...filters };
    this.loadingPromise = null;
    this.sentinel.classList.remove('is-loading');
    this.nextCursor = null;
    this.hasMore = false;
    this.loadedOnce = false;
    this.clearSelection();
    this.clearCards();

    if (!filters.siteId) {
      this.setStatus('Seleziona un cantiere per visualizzare foto e video.');
      this.sentinel.hidden = true;
      return;
    }

    this.setStatus('Caricamento...');
    this.sentinel.hidden = false;
    await this.loadNextPage();
  }

  async queryPage(cursor) {
    if (isFavoriteView(this.filters.viewMode)) {
      const user = this.getUser();
      return queryFavorites({
        ...this.filters,
        userId: user.id,
        context: favoriteContextForView(this.filters.viewMode),
      }, cursor, LIMITS.PAGE_SIZE);
    }
    return queryMediaPage(this.filters, cursor, LIMITS.PAGE_SIZE);
  }

  async loadNextPage() {
    if (!this.filters?.siteId) return false;
    if (this.loadingPromise) return this.loadingPromise;
    if (this.loadedOnce && !this.hasMore) return false;

    const operation = this.performLoadNextPage();
    this.loadingPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.loadingPromise === operation) this.loadingPromise = null;
    }
  }

  async performLoadNextPage() {
    const token = this.loadToken;
    this.sentinel.classList.add('is-loading');
    try {
      const page = await this.queryPage(this.nextCursor);
      if (token !== this.loadToken) return false;
      this.appendItems(page.items);
      this.nextCursor = page.nextCursor;
      this.hasMore = Boolean(page.nextCursor);
      this.loadedOnce = true;

      if (!this.items.length) {
        const message = isFavoriteView(this.filters.viewMode)
          ? 'Nessun preferito per i filtri selezionati.'
          : 'Nessun media per i filtri selezionati.';
        this.setStatus(message);
      } else {
        this.hideStatus();
      }
      this.sentinel.hidden = !this.hasMore;
      return true;
    } catch (error) {
      if (token === this.loadToken) this.setStatus(error?.message ?? 'Errore durante il caricamento.');
      return false;
    } finally {
      if (token === this.loadToken) {
        this.sentinel.classList.remove('is-loading');
      }
    }
  }

  appendItems(items) {
    if (!items.length) return;
    for (const item of items) {
      if (this.itemById.has(item.id)) continue;
      this.items.push(item);
      this.itemById.set(item.id, item);
    }
    this.scheduleRenderWindow(true);
  }

  scheduleRenderWindow(force = false) {
    this.forceNextRender ||= force;
    if (this.renderFrame !== null) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      const shouldForce = this.forceNextRender;
      this.forceNextRender = false;
      this.renderWindow(shouldForce);
    });
  }

  readLayoutMetrics() {
    const style = getComputedStyle(this.container);
    const columns = Math.max(
      1,
      style.gridTemplateColumns.split(/\s+/).filter(Boolean).length || 3,
    );
    const gap = Number.parseFloat(style.rowGap || style.gap) || 0;
    const width = this.container.clientWidth;
    const cardSize = width > 0
      ? Math.max(1, (width - gap * (columns - 1)) / columns)
      : 1;
    return {
      columns,
      gap,
      rowPitch: cardSize + gap,
    };
  }

  renderWindow(force = false) {
    if (!this.items.length) {
      if (this.container.childElementCount) this.container.replaceChildren();
      this.renderSignature = '';
      return;
    }

    const { columns, gap, rowPitch } = this.readLayoutMetrics();
    const containerTop = this.container.getBoundingClientRect().top;
    const visibleStartRow = Math.max(0, Math.floor(-containerTop / rowPitch));
    const visibleRows = Math.ceil(window.innerHeight / rowPitch) + 2;
    const range = computeGalleryWindow({
      itemCount: this.items.length,
      columns,
      visibleStartRow,
      visibleRows,
    });
    const signature = [
      range.startIndex,
      range.endIndex,
      this.items.length,
      columns,
      Math.round(rowPitch * 100),
    ].join(':');
    if (!force && signature === this.renderSignature) return;

    this.thumbnailObserver.disconnect();
    this.revokeRenderedObjectUrls();
    const fragment = document.createDocumentFragment();

    if (range.startRow > 0) {
      fragment.append(this.createSpacer(range.startRow * rowPitch - gap, 'gallery-spacer-top'));
    }

    for (let index = range.startIndex; index < range.endIndex; index += 1) {
      const item = this.items[index];
      const card = this.createCard(item);
      fragment.append(card);
      this.thumbnailObserver.observe(card);
    }

    const rowsAfter = range.totalRows - range.endRow;
    if (rowsAfter > 0) {
      fragment.append(this.createSpacer(rowsAfter * rowPitch - gap, 'gallery-spacer-bottom'));
    }

    this.container.replaceChildren(fragment);
    this.renderSignature = signature;
  }

  createSpacer(height, extraClass) {
    const spacer = document.createElement('div');
    spacer.className = `gallery-spacer ${extraClass}`;
    spacer.style.height = `${Math.max(0, height)}px`;
    spacer.setAttribute('aria-hidden', 'true');
    return spacer;
  }

  createCard(item) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'gallery-card';
    card.dataset.mediaId = item.id;
    card.setAttribute('aria-label', mediaDescription(item));
    card.setAttribute('aria-pressed', String(this.selectedIds.has(item.id)));
    card.classList.toggle('is-selected', this.selectedIds.has(item.id));

    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.className = 'gallery-thumbnail';
    card.append(image);

    const placeholder = document.createElement('span');
    placeholder.className = 'gallery-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    card.append(placeholder);

    if (item.mediaType === MEDIA_TYPES.VIDEO) {
      const badge = document.createElement('span');
      badge.className = 'video-badge';
      badge.textContent = '\u25b6';
      badge.setAttribute('aria-hidden', 'true');
      card.append(badge);
    }

    const check = document.createElement('span');
    check.className = 'selection-check';
    check.textContent = '\u2713';
    check.setAttribute('aria-hidden', 'true');
    card.append(check);

    this.bindCardGestures(card, item);
    return card;
  }

  bindCardGestures(card, item) {
    let pressTimer = null;
    let startX = 0;
    let startY = 0;
    let suppressClick = false;

    const cancelTimer = () => {
      clearTimeout(pressTimer);
      pressTimer = null;
    };

    card.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.pointerType === 'mouse') return;
      startX = event.clientX;
      startY = event.clientY;
      suppressClick = false;
      pressTimer = setTimeout(() => {
        suppressClick = true;
        navigator.vibrate?.(20);
        this.toggleSelection(item.id, true);
      }, LONG_PRESS_MS);
    });

    card.addEventListener('pointermove', (event) => {
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > MOVE_TOLERANCE) {
        cancelTimer();
      }
    });
    card.addEventListener('pointerup', cancelTimer);
    card.addEventListener('pointercancel', cancelTimer);
    card.addEventListener('pointerleave', cancelTimer);
    card.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.toggleSelection(item.id, true);
    });

    card.addEventListener('click', (event) => {
      if (suppressClick) {
        event.preventDefault();
        suppressClick = false;
        return;
      }
      if (this.selectedIds.size) {
        this.toggleSelection(item.id);
        return;
      }
      const index = this.items.findIndex((entry) => entry.id === item.id);
      if (index >= 0) this.onOpen?.(index);
    });
  }

  toggleSelection(mediaId, forceSelect = false) {
    const card = this.container.querySelector(`[data-media-id="${CSS.escape(mediaId)}"]`);
    const shouldSelect = forceSelect || !this.selectedIds.has(mediaId);
    if (shouldSelect) this.selectedIds.add(mediaId);
    else this.selectedIds.delete(mediaId);
    card?.classList.toggle('is-selected', shouldSelect);
    card?.setAttribute('aria-pressed', String(shouldSelect));
    this.onSelectionChange?.(this.getSelectedItems());
  }

  clearSelection() {
    if (!this.selectedIds.size) {
      this.onSelectionChange?.([]);
      return;
    }
    this.selectedIds.clear();
    for (const card of this.container.querySelectorAll('.is-selected')) {
      card.classList.remove('is-selected');
      card.setAttribute('aria-pressed', 'false');
    }
    this.onSelectionChange?.([]);
  }

  async ensureIndex(index) {
    while (index >= this.items.length && this.hasMore) {
      const loaded = await this.loadNextPage();
      if (!loaded) break;
    }
    return this.items[index] ?? null;
  }

  async handleThumbnailIntersections(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      this.thumbnailObserver.unobserve(entry.target);
      this.loadCardThumbnail(entry.target);
    }
  }

  async loadCardThumbnail(card) {
    const item = this.itemById.get(card.dataset.mediaId);
    if (!item) return;
    try {
      const blob = await getOrCreateThumbnail(item);
      if (!card.isConnected || !this.itemById.has(item.id)) return;
      const url = URL.createObjectURL(blob);
      this.objectUrls.add(url);
      const image = card.querySelector('img');
      image.addEventListener('load', () => card.classList.add('has-thumbnail'), { once: true });
      image.addEventListener('error', () => card.classList.add('thumbnail-error'), { once: true });
      image.src = url;
    } catch {
      card.classList.add('thumbnail-error');
    }
  }

  revokeRenderedObjectUrls() {
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls.clear();
  }

  clearCards() {
    this.thumbnailObserver.disconnect();
    if (this.renderFrame !== null) cancelAnimationFrame(this.renderFrame);
    this.renderFrame = null;
    this.forceNextRender = false;
    this.revokeRenderedObjectUrls();
    this.items = [];
    this.itemById.clear();
    this.renderSignature = '';
    this.container.replaceChildren();
  }

  setStatus(message) {
    this.status.textContent = message;
    this.status.hidden = false;
  }

  hideStatus() {
    this.status.hidden = true;
  }
}
