import { LIMITS, MEDIA_TYPES } from './config.js?v=1.1.0';
import { queryMediaPage } from './db.js?v=1.1.0';
import { favoriteContextForView, queryFavorites } from './favorites.js?v=1.1.0';
import { isFavoriteView } from './filters.js?v=1.1.0';
import { getOrCreateThumbnail, mediaDescription } from './media.js?v=1.1.0';

const LONG_PRESS_MS = 480;
const MOVE_TOLERANCE = 12;
const VIRTUALIZE_AFTER_ITEMS = 240;
const VIRTUAL_OVERSCAN_PX = 1100;
const DATE_ROW_HEIGHT = 46;
const MIN_COLUMNS = 2;
const MAX_COLUMNS = 6;
const PINCH_STEP = 1.22;
const COLUMN_STORAGE_KEY = 'cantiere-media-gallery-columns';
const HINT_STORAGE_KEY = 'cantiere-media-gallery-pinch-hint';

export function computeGalleryWindow({
  itemCount,
  columns,
  visibleStartRow,
  visibleRows,
}) {
  const safeCount = Math.max(0, Math.floor(itemCount));
  const safeColumns = Math.max(1, Math.floor(columns));
  const totalRows = Math.ceil(safeCount / safeColumns);
  if (!safeCount || safeCount <= VIRTUALIZE_AFTER_ITEMS || totalRows <= 84) {
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
  const startRow = Math.max(0, firstVisibleRow - 24);
  const endRow = Math.min(totalRows, firstVisibleRow + rowsOnScreen + 24);
  return {
    startIndex: startRow * safeColumns,
    endIndex: Math.min(safeCount, endRow * safeColumns),
    startRow,
    endRow,
    totalRows,
  };
}

function localDateParts(timestamp) {
  const date = new Date(Number(timestamp) || 0);
  if (Number.isNaN(date.getTime())) return { key: 'unknown', date: new Date(0) };
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return { key: `${year}-${month}-${day}`, date };
}

export function galleryDateKey(timestamp) {
  return localDateParts(timestamp).key;
}

function capitalize(value) {
  return value ? value[0].toLocaleUpperCase('it-IT') + value.slice(1) : value;
}

export function formatGalleryDateLabel(timestamp, now = Date.now()) {
  const target = localDateParts(timestamp);
  const today = localDateParts(now);
  const yesterdayDate = new Date(Number(now));
  yesterdayDate.setHours(12, 0, 0, 0);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = localDateParts(yesterdayDate.getTime());

  if (target.key === today.key) return 'Oggi';
  if (target.key === yesterday.key) return 'Ieri';

  const sameYear = target.date.getFullYear() === today.date.getFullYear();
  const formatter = new Intl.DateTimeFormat('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return capitalize(formatter.format(target.date));
}

export function buildGalleryLayoutRows(items, columns, now = Date.now()) {
  const safeColumns = Math.max(1, Math.floor(columns));
  const groups = [];
  let current = null;

  items.forEach((item, index) => {
    const key = galleryDateKey(item.takenAt);
    if (!current || current.key !== key) {
      current = {
        key,
        timestamp: item.takenAt,
        indexes: [],
      };
      groups.push(current);
    }
    current.indexes.push(index);
  });

  const rows = [];
  for (const group of groups) {
    rows.push({
      type: 'date',
      key: group.key,
      label: formatGalleryDateLabel(group.timestamp, now),
      count: group.indexes.length,
    });
    for (let index = 0; index < group.indexes.length; index += safeColumns) {
      rows.push({
        type: 'media',
        indexes: group.indexes.slice(index, index + safeColumns),
      });
    }
  }
  return rows;
}

export function calculatePinchColumns(
  startColumns,
  startDistance,
  currentDistance,
  minColumns = MIN_COLUMNS,
  maxColumns = MAX_COLUMNS,
) {
  const initial = Math.max(1, Number(startDistance) || 1);
  const current = Math.max(1, Number(currentDistance) || 1);
  const delta = Math.round(Math.log(initial / current) / Math.log(PINCH_STEP));
  return Math.min(maxColumns, Math.max(minColumns, Math.round(startColumns) + delta));
}

function lowerBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function computeVirtualRowRange(
  offsets,
  viewportTop,
  viewportHeight,
  overscan = VIRTUAL_OVERSCAN_PX,
) {
  const rowCount = Math.max(0, offsets.length - 1);
  if (!rowCount) return { startRow: 0, endRow: 0 };
  const startTarget = Math.max(0, viewportTop - overscan);
  const endTarget = Math.max(startTarget, viewportTop + viewportHeight + overscan);
  const startRow = Math.max(0, Math.min(rowCount - 1, lowerBound(offsets, startTarget) - 1));
  const endRow = Math.max(startRow + 1, Math.min(rowCount, lowerBound(offsets, endTarget) + 1));
  return { startRow, endRow };
}

function pointDistance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function pointCenter(first, second) {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

export class GalleryController {
  constructor({
    container,
    status,
    sentinel,
    gestureHint = null,
    zoomIndicator = null,
    getUser,
    onOpen,
    onSelectionChange,
  }) {
    Object.assign(this, {
      container,
      status,
      sentinel,
      gestureHint,
      zoomIndicator,
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
    this.layoutRows = [];
    this.layoutOffsets = [0];
    this.layoutTotalHeight = 0;
    this.layoutColumns = 0;
    this.layoutWidth = 0;
    this.touchPoints = new Map();
    this.pinchState = null;
    this.suppressClicksUntil = 0;
    this.zoomIndicatorTimer = null;
    this.columns = this.readInitialColumnCount();
    this.container.style.setProperty('--gallery-columns', String(this.columns));

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
    window.addEventListener('resize', () => {
      this.invalidateLayout();
      this.scheduleRenderWindow(true);
    }, { passive: true });
    this.bindPinchZoom();
  }

  readInitialColumnCount() {
    try {
      const stored = Number.parseInt(localStorage.getItem(COLUMN_STORAGE_KEY), 10);
      if (stored >= MIN_COLUMNS && stored <= MAX_COLUMNS) return stored;
    } catch {
      // Storage may be unavailable in a private context.
    }
    return window.matchMedia?.('(min-width: 600px)').matches ? 4 : 3;
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
      this.hideGestureHint();
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
        this.hideGestureHint();
      } else {
        this.hideStatus();
        this.showGestureHintOnce();
      }
      this.sentinel.hidden = !this.hasMore;
      return true;
    } catch (error) {
      if (token === this.loadToken) this.setStatus(error?.message ?? 'Errore durante il caricamento.');
      return false;
    } finally {
      if (token === this.loadToken) this.sentinel.classList.remove('is-loading');
    }
  }

  appendItems(items) {
    if (!items.length) return;
    for (const item of items) {
      if (this.itemById.has(item.id)) continue;
      this.items.push(item);
      this.itemById.set(item.id, item);
    }
    this.invalidateLayout();
    this.scheduleRenderWindow(true);
  }

  invalidateLayout() {
    this.layoutRows = [];
    this.layoutOffsets = [0];
    this.layoutTotalHeight = 0;
    this.layoutColumns = 0;
    this.layoutWidth = 0;
    this.renderSignature = '';
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
    const gap = Number.parseFloat(style.getPropertyValue('--gallery-gap')) || 2;
    const width = this.container.clientWidth;
    const cardSize = width > 0
      ? Math.max(1, (width - gap * (this.columns - 1)) / this.columns)
      : 1;
    return { columns: this.columns, gap, width, cardSize };
  }

  ensureLayout(metrics) {
    if (
      this.layoutRows.length
      && this.layoutColumns === metrics.columns
      && Math.abs(this.layoutWidth - metrics.width) < 0.5
    ) return;

    this.layoutRows = buildGalleryLayoutRows(this.items, metrics.columns);
    this.layoutOffsets = [0];
    for (const row of this.layoutRows) {
      const height = row.type === 'date' ? DATE_ROW_HEIGHT : metrics.cardSize;
      this.layoutOffsets.push(this.layoutOffsets.at(-1) + height + metrics.gap);
    }
    this.layoutTotalHeight = Math.max(
      0,
      (this.layoutOffsets.at(-1) || 0) - (this.layoutRows.length ? metrics.gap : 0),
    );
    this.layoutColumns = metrics.columns;
    this.layoutWidth = metrics.width;
  }

  renderWindow(force = false) {
    if (!this.items.length) {
      if (this.container.childElementCount) this.container.replaceChildren();
      this.renderSignature = '';
      return;
    }

    const metrics = this.readLayoutMetrics();
    this.ensureLayout(metrics);
    const containerTop = this.container.getBoundingClientRect().top;
    const viewportTop = Math.max(0, -containerTop);
    const range = this.items.length <= VIRTUALIZE_AFTER_ITEMS
      ? { startRow: 0, endRow: this.layoutRows.length }
      : computeVirtualRowRange(this.layoutOffsets, viewportTop, window.innerHeight);
    const signature = [
      range.startRow,
      range.endRow,
      this.items.length,
      metrics.columns,
      Math.round(metrics.cardSize * 100),
    ].join(':');
    if (!force && signature === this.renderSignature) return;

    this.thumbnailObserver.disconnect();
    this.revokeRenderedObjectUrls();
    const fragment = document.createDocumentFragment();

    if (range.startRow > 0) {
      fragment.append(this.createSpacer(this.layoutOffsets[range.startRow], 'gallery-spacer-top'));
    }

    for (let rowIndex = range.startRow; rowIndex < range.endRow; rowIndex += 1) {
      const row = this.layoutRows[rowIndex];
      const element = row.type === 'date'
        ? this.createDateRow(row)
        : this.createMediaRow(row);
      element.classList.toggle('is-last', rowIndex === this.layoutRows.length - 1);
      fragment.append(element);
    }

    if (range.endRow < this.layoutRows.length) {
      const remainingHeight = this.layoutTotalHeight - this.layoutOffsets[range.endRow];
      fragment.append(this.createSpacer(remainingHeight, 'gallery-spacer-bottom'));
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

  createDateRow(row) {
    const header = document.createElement('div');
    header.className = 'gallery-layout-row gallery-date-row';
    header.dataset.dateKey = row.key;
    const label = document.createElement('strong');
    label.textContent = row.label;
    const count = document.createElement('span');
    count.textContent = `${row.count} ${row.count === 1 ? 'elemento' : 'elementi'}`;
    header.append(label, count);
    return header;
  }

  createMediaRow(row) {
    const element = document.createElement('div');
    element.className = 'gallery-layout-row gallery-media-row';
    for (const index of row.indexes) {
      const item = this.items[index];
      if (!item) continue;
      const card = this.createCard(item);
      element.append(card);
      this.thumbnailObserver.observe(card);
    }
    return element;
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
        if (this.pinchState || this.touchPoints.size > 1) return;
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
      if (Date.now() < this.suppressClicksUntil || suppressClick) {
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

  bindPinchZoom() {
    this.container.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch') return;
      this.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.touchPoints.size === 2) this.startPinch();
    }, { passive: true });

    window.addEventListener('pointermove', (event) => {
      if (!this.touchPoints.has(event.pointerId)) return;
      this.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (!this.pinchState || this.touchPoints.size < 2) return;
      event.preventDefault();
      const [first, second] = [...this.touchPoints.values()];
      const distance = pointDistance(first, second);
      const target = calculatePinchColumns(
        this.pinchState.startColumns,
        this.pinchState.startDistance,
        distance,
      );
      if (target !== this.columns) this.setColumnCount(target, this.pinchState);
    }, { passive: false });

    const finishPointer = (event) => {
      if (!this.touchPoints.has(event.pointerId)) return;
      this.touchPoints.delete(event.pointerId);
      if (this.touchPoints.size < 2) this.finishPinch();
    };
    window.addEventListener('pointerup', finishPointer, { passive: true });
    window.addEventListener('pointercancel', finishPointer, { passive: true });

    this.container.addEventListener('gesturestart', (event) => {
      event.preventDefault();
      if (!this.pinchState) this.startPinch(1);
    }, { passive: false });
    this.container.addEventListener('gesturechange', (event) => {
      if (!this.pinchState) return;
      event.preventDefault();
      const target = calculatePinchColumns(
        this.pinchState.startColumns,
        1,
        Number(event.scale) || 1,
      );
      if (target !== this.columns) this.setColumnCount(target, this.pinchState);
    }, { passive: false });
    this.container.addEventListener('gestureend', () => this.finishPinch(), { passive: true });
  }

  startPinch(forcedDistance = null) {
    const points = [...this.touchPoints.values()];
    const first = points[0] ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const second = points[1] ?? first;
    const center = pointCenter(first, second);
    const target = document.elementFromPoint(center.x, center.y)?.closest?.('.gallery-card');
    const anchorCard = target && this.container.contains(target) ? target : null;
    const galleryTop = window.scrollY + this.container.getBoundingClientRect().top;
    this.pinchState = {
      startColumns: this.columns,
      startDistance: forcedDistance ?? Math.max(1, pointDistance(first, second)),
      anchorId: anchorCard?.dataset.mediaId ?? null,
      anchorScreenTop: anchorCard?.getBoundingClientRect().top ?? center.y,
      galleryDocumentTop: galleryTop,
    };
    this.container.classList.add('is-pinching');
    this.suppressClicksUntil = Number.POSITIVE_INFINITY;
  }

  finishPinch() {
    if (!this.pinchState) return;
    this.pinchState = null;
    this.container.classList.remove('is-pinching');
    this.suppressClicksUntil = Date.now() + 450;
  }

  setColumnCount(nextColumns, anchor = null) {
    const target = Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.round(nextColumns)));
    if (target === this.columns) return;
    this.columns = target;
    this.container.style.setProperty('--gallery-columns', String(target));
    try {
      localStorage.setItem(COLUMN_STORAGE_KEY, String(target));
      localStorage.setItem(HINT_STORAGE_KEY, 'shown');
    } catch {
      // The visual setting still applies for the current session.
    }

    this.invalidateLayout();
    const metrics = this.readLayoutMetrics();
    this.ensureLayout(metrics);
    if (anchor?.anchorId) {
      const itemIndex = this.items.findIndex((item) => item.id === anchor.anchorId);
      const rowIndex = this.layoutRows.findIndex(
        (row) => row.type === 'media' && row.indexes.includes(itemIndex),
      );
      if (rowIndex >= 0) {
        const desiredScroll = anchor.galleryDocumentTop
          + this.layoutOffsets[rowIndex]
          - anchor.anchorScreenTop;
        window.scrollTo({ top: Math.max(0, desiredScroll), behavior: 'auto' });
      }
    }
    this.showZoomIndicator();
    this.scheduleRenderWindow(true);
  }

  showZoomIndicator() {
    if (!this.zoomIndicator) return;
    clearTimeout(this.zoomIndicatorTimer);
    this.zoomIndicator.textContent = `${this.columns} colonne`;
    this.zoomIndicator.hidden = false;
    this.zoomIndicatorTimer = setTimeout(() => {
      this.zoomIndicator.hidden = true;
    }, 900);
  }

  showGestureHintOnce() {
    if (!this.gestureHint || !('ontouchstart' in window)) return;
    try {
      if (localStorage.getItem(HINT_STORAGE_KEY) === 'shown') return;
      localStorage.setItem(HINT_STORAGE_KEY, 'shown');
    } catch {
      // Show the hint even if persistence is unavailable.
    }
    this.gestureHint.hidden = false;
    setTimeout(() => {
      if (this.gestureHint) this.gestureHint.hidden = true;
    }, 6500);
  }

  hideGestureHint() {
    if (this.gestureHint) this.gestureHint.hidden = true;
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
    this.invalidateLayout();
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
