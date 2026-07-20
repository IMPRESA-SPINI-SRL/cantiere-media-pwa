import { MEDIA_TYPES } from './config.js?v=1.0.3';
import { favoriteContextForView, isFavorite, toggleFavorite } from './favorites.js?v=1.0.3';
import { downloadMedia, getMediaFile, shareMediaItems } from './media.js?v=1.0.3';
import { clamp, formatBytes, formatDateTime, formatDuration } from './utils.js?v=1.0.3';
import { closeDialog, openDialog, showToast } from './ui.js?v=1.0.3';

const INTERACTIVE_TARGET_SELECTOR = 'button, video, input, select, textarea, a[href], [role="button"]';
const PLAY_SYMBOL = '▶';
const PAUSE_SYMBOL = 'Ⅱ';

export function isViewerInteractiveTarget(target) {
  return Boolean(target?.closest?.(INTERACTIVE_TARGET_SELECTOR));
}

export function getVideoPlaybackButtonModel({ paused, ended }) {
  const stopped = Boolean(paused || ended);
  return {
    stopped,
    symbol: stopped ? PLAY_SYMBOL : PAUSE_SYMBOL,
    label: ended
      ? 'Riproduci di nuovo'
      : (stopped ? 'Riproduci video' : 'Metti in pausa il video'),
  };
}

export function getVideoTimelineModel(currentTime, duration) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeCurrentTime = Number.isFinite(currentTime)
    ? clamp(currentTime, 0, safeDuration || Math.max(0, currentTime))
    : 0;
  return {
    currentTime: safeCurrentTime,
    duration: safeDuration,
    progress: safeDuration > 0 ? Math.round((safeCurrentTime / safeDuration) * 1000) : 0,
    label: `${formatDuration(safeCurrentTime)} / ${safeDuration > 0 ? formatDuration(safeDuration) : '--:--'}`,
  };
}

function updatePlaybackButton(button, model) {
  button.textContent = model.symbol;
  button.setAttribute('aria-label', model.label);
  button.title = model.label;
}

export class ViewerController {
  constructor({
    dialog,
    stage,
    transform,
    closeButton,
    shareButton,
    favoriteButton,
    position,
    caption,
    videoCenterButton,
    videoControls,
    videoControlButton,
    videoProgress,
    videoTime,
    getItems,
    getHasMore,
    ensureIndex,
    getUser,
    getViewMode,
    onClose,
  }) {
    Object.assign(this, {
      dialog,
      stage,
      transform,
      closeButton,
      shareButton,
      favoriteButton,
      position,
      caption,
      videoCenterButton,
      videoControls,
      videoControlButton,
      videoProgress,
      videoTime,
      getItems,
      getHasMore,
      ensureIndex,
      getUser,
      getViewMode,
      onClose,
    });
    this.index = -1;
    this.media = null;
    this.video = null;
    this.objectUrl = null;
    this.scale = 1;
    this.translateX = 0;
    this.translateY = 0;
    this.pointers = new Map();
    this.singleGesture = null;
    this.pinchGesture = null;
    this.lastTap = null;
    this.favoriteChanged = false;
    this.renderToken = 0;
    this.bindEvents();
    this.setVideoUiVisible(false);
  }

  bindEvents() {
    this.closeButton.addEventListener('click', () => this.close());
    this.shareButton.addEventListener('click', () => this.shareCurrent());
    this.favoriteButton.addEventListener('click', () => this.toggleCurrentFavorite());
    this.videoCenterButton.addEventListener('click', () => this.toggleVideoPlayback());
    this.videoControlButton.addEventListener('click', () => this.toggleVideoPlayback());
    this.videoProgress.addEventListener('input', () => this.seekCurrentVideo());

    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.close();
    });
    this.dialog.addEventListener('close', () => this.cleanupAfterClose());

    this.stage.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    this.stage.addEventListener('pointermove', (event) => this.onPointerMove(event));
    this.stage.addEventListener('pointerup', (event) => this.onPointerUp(event));
    this.stage.addEventListener('pointercancel', (event) => this.onPointerUp(event));
    document.addEventListener('keydown', (event) => {
      if (!this.dialog.open) return;
      if (event.key === 'ArrowLeft' && !isViewerInteractiveTarget(event.target)) this.navigate(-1);
      if (event.key === 'ArrowRight' && !isViewerInteractiveTarget(event.target)) this.navigate(1);
      if (event.key === 'Escape') this.close();
    });
  }

  async open(index) {
    this.favoriteChanged = false;
    openDialog(this.dialog);
    await this.showIndex(index);
  }

  close() {
    this.renderToken += 1;
    this.video?.pause();
    closeDialog(this.dialog);
  }

  cleanupAfterClose() {
    this.renderToken += 1;
    this.clearVideoState();
    this.revokeObjectUrl();
    this.transform.replaceChildren();
    this.dialog.classList.remove('is-video');
    this.media = null;
    this.index = -1;
    this.resetTransform();
    this.onClose?.({ favoriteChanged: this.favoriteChanged });
  }

  revokeObjectUrl() {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  async showIndex(index) {
    const token = ++this.renderToken;
    const media = await this.ensureIndex(index);
    if (!media || token !== this.renderToken || !this.dialog.open) return;
    this.index = index;
    this.media = media;
    this.favoriteButton.disabled = false;
    this.resetTransform();
    this.clearVideoState();
    this.revokeObjectUrl();
    this.transform.replaceChildren();
    const isVideo = media.mediaType === MEDIA_TYPES.VIDEO;
    this.transform.classList.toggle('is-video', isVideo);
    this.dialog.classList.toggle('is-video', isVideo);

    try {
      const file = await getMediaFile(media);
      if (token !== this.renderToken || !this.dialog.open) return;
      this.objectUrl = URL.createObjectURL(file);
      if (isVideo) {
        const video = this.createVideoElement(this.objectUrl);
        this.transform.append(video);
        this.attachVideo(video);
      } else {
        const image = document.createElement('img');
        image.className = 'viewer-image';
        image.alt = media.fileName;
        image.draggable = false;
        image.decoding = 'async';
        image.src = this.objectUrl;
        this.transform.append(image);
      }
    } catch (error) {
      if (token !== this.renderToken || !this.dialog.open) return;
      this.clearVideoState();
      const message = document.createElement('p');
      message.className = 'viewer-error';
      message.textContent = error?.message ?? 'File non disponibile.';
      this.transform.append(message);
    }

    const loadedCount = this.getItems().length;
    const hasMore = Boolean(this.getHasMore?.());
    this.position.textContent = loadedCount > 1 || hasMore
      ? `${index + 1} / ${loadedCount}${hasMore ? '+' : ''}`
      : '';
    const parts = [media.authorNameSnapshot, formatDateTime(media.takenAt), formatBytes(media.size)];
    if (isVideo) parts.push(formatDuration(media.duration));
    this.caption.textContent = parts.filter(Boolean).join('  \u2022  ');
    await this.updateFavoriteButton(token, media.id);
  }

  createVideoElement(source) {
    const video = document.createElement('video');
    video.className = 'viewer-video';
    video.controls = false;
    video.preload = 'metadata';
    video.playsInline = true;
    video.tabIndex = 0;
    video.setAttribute('aria-label', 'Video del cantiere. Usa i pulsanti Play e Pausa visualizzati sullo schermo.');
    video.src = source;
    return video;
  }

  attachVideo(video) {
    this.video = video;
    this.setVideoUiVisible(true);

    const updatePlayback = () => {
      if (this.video === video) this.updateVideoPlaybackUi();
    };
    const updateTimeline = () => {
      if (this.video === video) this.updateVideoTimelineUi();
    };

    video.addEventListener('click', () => this.toggleVideoPlayback());
    video.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.toggleVideoPlayback();
    });
    for (const eventName of ['play', 'pause', 'ended']) {
      video.addEventListener(eventName, updatePlayback);
    }
    for (const eventName of ['loadedmetadata', 'durationchange', 'timeupdate', 'seeking', 'seeked']) {
      video.addEventListener(eventName, updateTimeline);
    }
    video.addEventListener('error', () => {
      if (this.video === video) {
        showToast('Il browser non riesce a riprodurre questo formato video.', { type: 'error' });
      }
    });

    this.updateVideoPlaybackUi();
    this.updateVideoTimelineUi();
  }

  setVideoUiVisible(visible) {
    this.videoCenterButton.hidden = !visible;
    this.videoControls.hidden = !visible;
    this.dialog.classList.toggle('has-video-controls', visible);
    if (!visible) {
      this.dialog.classList.remove('video-is-playing');
      this.videoProgress.disabled = true;
      this.videoProgress.value = '0';
      this.videoTime.textContent = '0:00 / --:--';
      const initial = getVideoPlaybackButtonModel({ paused: true, ended: false });
      updatePlaybackButton(this.videoCenterButton, initial);
      updatePlaybackButton(this.videoControlButton, initial);
    }
  }

  clearVideoState() {
    const video = this.video;
    this.video = null;
    video?.pause();
    this.setVideoUiVisible(false);
  }

  updateVideoPlaybackUi() {
    if (!this.video) return;
    const model = getVideoPlaybackButtonModel(this.video);
    this.dialog.classList.toggle('video-is-playing', !model.stopped);
    updatePlaybackButton(this.videoCenterButton, model);
    updatePlaybackButton(this.videoControlButton, model);
  }

  updateVideoTimelineUi() {
    if (!this.video) return;
    const model = getVideoTimelineModel(this.video.currentTime, this.video.duration);
    this.videoProgress.disabled = model.duration <= 0;
    this.videoProgress.value = String(model.progress);
    this.videoProgress.setAttribute(
      'aria-valuetext',
      `${formatDuration(model.currentTime)} di ${model.duration > 0 ? formatDuration(model.duration) : 'durata non disponibile'}`,
    );
    this.videoTime.textContent = model.label;
  }

  async toggleVideoPlayback() {
    const video = this.video;
    if (!video) return;
    if (video.paused || video.ended) {
      if (video.ended) video.currentTime = 0;
      try {
        await video.play();
      } catch {
        showToast('Il browser non riesce ad avviare il video.', { type: 'error' });
      }
    } else {
      video.pause();
    }
  }

  seekCurrentVideo() {
    const video = this.video;
    const duration = Number.isFinite(video?.duration) ? video.duration : 0;
    if (!video || duration <= 0) return;
    video.currentTime = (Number(this.videoProgress.value) / 1000) * duration;
    this.updateVideoTimelineUi();
  }

  async navigate(direction) {
    if (!this.dialog.open) return;
    const target = this.index + direction;
    if (target < 0) return;
    const media = await this.ensureIndex(target);
    if (media) await this.showIndex(target);
  }

  async updateFavoriteButton(token = this.renderToken, mediaId = this.media?.id) {
    if (!this.media) return;
    const user = this.getUser();
    const context = favoriteContextForView(this.getViewMode());
    const favorite = await isFavorite(user.id, context, mediaId);
    if (token !== this.renderToken || this.media?.id !== mediaId || !this.dialog.open) return;
    this.favoriteButton.classList.toggle('is-favorite', favorite);
    this.favoriteButton.setAttribute('aria-pressed', String(favorite));
    this.favoriteButton.setAttribute('aria-label', favorite ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti');
    this.favoriteButton.title = favorite ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti';
  }

  async toggleCurrentFavorite() {
    if (!this.media) return;
    const media = this.media;
    const token = this.renderToken;
    const user = this.getUser();
    const context = favoriteContextForView(this.getViewMode());
    this.favoriteButton.disabled = true;
    try {
      const favorite = await toggleFavorite(user, media, context);
      this.favoriteChanged = true;
      if (token === this.renderToken && this.media?.id === media.id && this.dialog.open) {
        this.favoriteButton.classList.toggle('is-favorite', favorite);
        this.favoriteButton.setAttribute('aria-pressed', String(favorite));
      }
      showToast(favorite ? 'Aggiunto ai preferiti.' : 'Rimosso dai preferiti.', { type: 'success' });
    } catch (error) {
      showToast(error?.message ?? 'Errore nei preferiti.', { type: 'error' });
    } finally {
      if (token === this.renderToken) this.favoriteButton.disabled = false;
    }
  }

  async shareCurrent() {
    if (!this.media) return;
    const media = this.media;
    this.shareButton.disabled = true;
    try {
      await shareMediaItems([media]);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (['SHARE_UNAVAILABLE', 'SHARE_FILES_UNSUPPORTED'].includes(error?.code)) {
        await downloadMedia(media);
        showToast('Condivisione non disponibile: file salvato tramite download.', { type: 'warning' });
      } else {
        showToast(error?.message ?? 'Condivisione non riuscita.', { type: 'error' });
      }
    } finally {
      this.shareButton.disabled = false;
    }
  }

  isPhoto() {
    return this.media?.mediaType === MEDIA_TYPES.PHOTO;
  }

  resetTransform() {
    this.scale = 1;
    this.translateX = 0;
    this.translateY = 0;
    this.pointers.clear();
    this.singleGesture = null;
    this.pinchGesture = null;
    this.lastTap = null;
    this.applyTransform();
  }

  applyTransform() {
    this.transform.style.transform = `translate3d(${this.translateX}px, ${this.translateY}px, 0) scale(${this.scale})`;
  }

  onPointerDown(event) {
    if (event.button !== 0) return;
    if (isViewerInteractiveTarget(event.target)) return;
    this.stage.setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size === 1) {
      this.singleGesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        startTime: performance.now(),
      };
    } else if (this.pointers.size === 2 && this.isPhoto()) {
      const [first, second] = [...this.pointers.values()];
      const rect = this.stage.getBoundingClientRect();
      const centerX = (first.x + second.x) / 2 - (rect.left + rect.width / 2);
      const centerY = (first.y + second.y) / 2 - (rect.top + rect.height / 2);
      this.pinchGesture = {
        distance: Math.hypot(second.x - first.x, second.y - first.y),
        scale: this.scale,
        contentX: (centerX - this.translateX) / this.scale,
        contentY: (centerY - this.translateY) / this.scale,
      };
      this.singleGesture = null;
    }
  }

  onPointerMove(event) {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size === 2 && this.isPhoto() && this.pinchGesture) {
      event.preventDefault();
      const [first, second] = [...this.pointers.values()];
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const rect = this.stage.getBoundingClientRect();
      const centerX = (first.x + second.x) / 2 - (rect.left + rect.width / 2);
      const centerY = (first.y + second.y) / 2 - (rect.top + rect.height / 2);
      this.scale = clamp(
        this.pinchGesture.scale * (distance / Math.max(1, this.pinchGesture.distance)),
        1,
        5,
      );
      this.translateX = centerX - this.pinchGesture.contentX * this.scale;
      this.translateY = centerY - this.pinchGesture.contentY * this.scale;
      this.applyTransform();
      return;
    }

    if (this.pointers.size === 1 && this.singleGesture && this.scale > 1 && this.isPhoto()) {
      event.preventDefault();
      this.translateX += event.clientX - this.singleGesture.lastX;
      this.translateY += event.clientY - this.singleGesture.lastY;
      this.singleGesture.lastX = event.clientX;
      this.singleGesture.lastY = event.clientY;
      this.applyTransform();
    }
  }

  onPointerUp(event) {
    const gesture = this.singleGesture;
    this.pointers.delete(event.pointerId);
    this.stage.releasePointerCapture?.(event.pointerId);

    if (this.pointers.size === 1 && this.isPhoto()) {
      const [remaining] = [...this.pointers.entries()];
      this.singleGesture = {
        pointerId: remaining[0],
        startX: remaining[1].x,
        startY: remaining[1].y,
        lastX: remaining[1].x,
        lastY: remaining[1].y,
        startTime: performance.now(),
        suppressNavigation: true,
      };
      this.pinchGesture = null;
      return;
    }
    if (this.pointers.size) return;

    this.pinchGesture = null;
    if (!gesture) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const distance = Math.hypot(deltaX, deltaY);
    const elapsed = performance.now() - gesture.startTime;

    if (this.scale > 1 && this.isPhoto()) {
      this.clampTranslation();
    } else if (gesture.suppressNavigation) {
      this.applyTransform();
    } else if (Math.abs(deltaX) > 60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
      this.navigate(deltaX < 0 ? 1 : -1);
    } else if (distance < 12 && elapsed < 280 && this.isPhoto()) {
      this.handleTap(event.clientX, event.clientY);
    }
    this.singleGesture = null;
  }

  handleTap(clientX, clientY) {
    const now = performance.now();
    if (
      this.lastTap
      && now - this.lastTap.time < 320
      && Math.hypot(clientX - this.lastTap.x, clientY - this.lastTap.y) < 32
    ) {
      this.toggleZoomAt(clientX, clientY);
      this.lastTap = null;
      return;
    }
    this.lastTap = { time: now, x: clientX, y: clientY };
  }

  toggleZoomAt(clientX, clientY) {
    if (this.scale > 1) {
      this.scale = 1;
      this.translateX = 0;
      this.translateY = 0;
    } else {
      const rect = this.stage.getBoundingClientRect();
      this.scale = 2.5;
      this.translateX = (rect.left + rect.width / 2 - clientX) * (this.scale - 1);
      this.translateY = (rect.top + rect.height / 2 - clientY) * (this.scale - 1);
      this.clampTranslation(false);
    }
    this.applyTransform();
  }

  clampTranslation(apply = true) {
    const image = this.transform.querySelector('img');
    if (!image) return;
    const stageRect = this.stage.getBoundingClientRect();
    const ratio = (image.naturalWidth || 1) / (image.naturalHeight || 1);
    let baseWidth = stageRect.width;
    let baseHeight = baseWidth / ratio;
    if (baseHeight > stageRect.height) {
      baseHeight = stageRect.height;
      baseWidth = baseHeight * ratio;
    }
    const maxX = Math.max(0, (baseWidth * this.scale - stageRect.width) / 2);
    const maxY = Math.max(0, (baseHeight * this.scale - stageRect.height) / 2);
    this.translateX = clamp(this.translateX, -maxX, maxX);
    this.translateY = clamp(this.translateY, -maxY, maxY);
    if (this.scale <= 1.01) {
      this.scale = 1;
      this.translateX = 0;
      this.translateY = 0;
    }
    if (apply) this.applyTransform();
  }
}
