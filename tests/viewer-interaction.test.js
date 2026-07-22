import test from 'node:test';
import assert from 'node:assert/strict';

import {
  constrainPhotoTransform,
  getVideoPlaybackButtonModel,
  getVideoTimelineModel,
  isViewerInteractiveTarget,
  ViewerController,
} from '../js/viewer.js';

test('il viewer non intercetta i controlli video', () => {
  const target = {
    closest(selector) {
      assert.match(selector, /video/);
      return { tagName: 'VIDEO' };
    },
  };
  assert.equal(isViewerInteractiveTarget(target), true);
});

test('lo sfondo del viewer resta disponibile per le gesture', () => {
  const target = { closest: () => null };
  assert.equal(isViewerInteractiveTarget(target), false);
});

test('il controllo video mostra Play quando il filmato e fermo', () => {
  const model = getVideoPlaybackButtonModel({ paused: true, ended: false });
  assert.equal(model.stopped, true);
  assert.equal(model.label, 'Riproduci video');
  assert.equal(model.symbol, '▶');
});

test('il controllo video mostra Pausa durante la riproduzione', () => {
  const model = getVideoPlaybackButtonModel({ paused: false, ended: false });
  assert.equal(model.stopped, false);
  assert.equal(model.label, 'Metti in pausa il video');
  assert.equal(model.symbol, 'Ⅱ');
});

test('la timeline video calcola avanzamento e tempi leggibili', () => {
  assert.deepEqual(getVideoTimelineModel(15, 60), {
    currentTime: 15,
    duration: 60,
    progress: 250,
    label: '0:15 / 1:00',
  });
});

test('la timeline video gestisce metadati non ancora disponibili', () => {
  assert.deepEqual(getVideoTimelineModel(0, Number.NaN), {
    currentTime: 0,
    duration: 0,
    progress: 0,
    label: '0:00 / --:--',
  });
});


class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.values = new Set(String(owner.className || '').split(/\s+/).filter(Boolean));
  }

  toggle(name, force) {
    const shouldAdd = force === undefined ? !this.values.has(name) : Boolean(force);
    if (shouldAdd) this.values.add(name);
    else this.values.delete(name);
    this.owner.className = [...this.values].join(' ');
    return shouldAdd;
  }

  remove(...names) {
    for (const name of names) this.values.delete(name);
    this.owner.className = [...this.values].join(' ');
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = '';
    this.disabled = false;
    this.hidden = false;
    this.textContent = '';
    this.title = '';
    this.value = '';
    this.currentTime = 0;
    this.duration = Number.NaN;
    this.paused = true;
    this.ended = false;
  }

  get classList() {
    if (!this._classList) this._classList = new FakeClassList(this);
    return this._classList;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = [...nodes];
  }

  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }
}

test('il video viene creato senza dipendere dai controlli nativi', () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
  };

  try {
    const controller = Object.create(ViewerController.prototype);
    const video = controller.createVideoElement('blob:test-video');
    assert.equal(video.tagName, 'VIDEO');
    assert.equal(video.className, 'viewer-video');
    assert.equal(video.controls, false);
    assert.equal(video.src, 'blob:test-video');
    assert.match(video.getAttribute('aria-label'), /Play e Pausa/);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('i controlli video statici vengono mostrati sopra il contenuto trasformato', () => {
  const controller = Object.create(ViewerController.prototype);
  controller.dialog = new FakeElement('dialog');
  controller.videoCenterButton = new FakeElement('button');
  controller.videoControls = new FakeElement('div');
  controller.videoControlButton = new FakeElement('button');
  controller.videoProgress = new FakeElement('input');
  controller.videoTime = new FakeElement('output');

  controller.setVideoUiVisible(true);
  assert.equal(controller.videoCenterButton.hidden, false);
  assert.equal(controller.videoControls.hidden, false);
  assert.equal(controller.dialog.classList.contains('has-video-controls'), true);

  controller.setVideoUiVisible(false);
  assert.equal(controller.videoCenterButton.hidden, true);
  assert.equal(controller.videoControls.hidden, true);
  assert.equal(controller.videoCenterButton.textContent, '▶');
  assert.equal(controller.videoControlButton.textContent, '▶');
  assert.equal(controller.videoTime.textContent, '0:00 / --:--');
});


test('il doppio tap su una foto gia ingrandita torna esattamente alla vista iniziale', () => {
  const controller = Object.create(ViewerController.prototype);
  controller.scale = 2.5;
  controller.translateX = 120;
  controller.translateY = -80;
  controller.pointers = new Map();
  controller.singleGesture = null;
  controller.pinchGesture = null;
  controller.pinchActive = false;
  controller.lastTap = null;
  controller.settleTimer = null;
  controller.transform = {
    style: {},
    classList: {
      add() {},
      remove() {},
    },
  };

  controller.toggleZoomAt(100, 100);
  clearTimeout(controller.settleTimer);

  assert.equal(controller.scale, 1);
  assert.equal(controller.translateX, 0);
  assert.equal(controller.translateY, 0);
  assert.equal(controller.transform.style.transform, 'translate3d(0px, 0px, 0) scale(1)');
});

test('il trascinamento della foto viene bloccato ai bordi visibili', () => {
  const constrained = constrainPhotoTransform({
    scale: 2,
    translateX: 900,
    translateY: -900,
    stageWidth: 400,
    stageHeight: 800,
    mediaWidth: 800,
    mediaHeight: 1200,
  });

  assert.equal(constrained.scale, 2);
  assert.equal(constrained.maxX, 200);
  assert.equal(constrained.maxY, 200);
  assert.equal(constrained.translateX, 200);
  assert.equal(constrained.translateY, -200);
});

test('un pinch vicino alla scala iniziale scatta precisamente a 1x', () => {
  const constrained = constrainPhotoTransform({
    scale: 1.15,
    translateX: 22,
    translateY: -18,
    stageWidth: 400,
    stageHeight: 800,
    mediaWidth: 800,
    mediaHeight: 1200,
    snapToInitial: true,
  });

  assert.deepEqual(constrained, {
    scale: 1,
    translateX: 0,
    translateY: 0,
    maxX: 0,
    maxY: 0,
  });
});

test('uno zoom intenzionale sopra la soglia non viene azzerato', () => {
  const constrained = constrainPhotoTransform({
    scale: 1.5,
    translateX: 20,
    translateY: 20,
    stageWidth: 400,
    stageHeight: 800,
    mediaWidth: 800,
    mediaHeight: 1200,
    snapToInitial: true,
  });

  assert.equal(constrained.scale, 1.5);
  assert.equal(constrained.translateX, 20);
  assert.equal(constrained.translateY, 20);
});
