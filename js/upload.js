import { getStorageEstimate, requestPersistentStorage, saveMediaFile } from './media.js?v=1.0.3';
import { formatBytes } from './utils.js?v=1.0.3';
import { closeDialog, openDialog, showToast } from './ui.js?v=1.0.3';

export class UploadController {
  constructor({
    dialog,
    photoButton,
    videoButton,
    galleryButton,
    photoInput,
    videoInput,
    galleryInput,
    progressWrap,
    progress,
    progressText,
    closeButton,
    getContext,
    onUploaded,
  }) {
    Object.assign(this, {
      dialog,
      photoButton,
      videoButton,
      galleryButton,
      photoInput,
      videoInput,
      galleryInput,
      progressWrap,
      progress,
      progressText,
      closeButton,
      getContext,
      onUploaded,
    });
    this.processing = false;
    this.bindEvents();
  }

  bindEvents() {
    this.photoButton.addEventListener('click', () => this.photoInput.click());
    this.videoButton.addEventListener('click', () => this.videoInput.click());
    this.galleryButton.addEventListener('click', () => this.galleryInput.click());
    this.closeButton.addEventListener('click', () => {
      if (!this.processing) closeDialog(this.dialog);
    });
    this.dialog.addEventListener('cancel', (event) => {
      if (this.processing) event.preventDefault();
    });

    for (const input of [this.photoInput, this.videoInput, this.galleryInput]) {
      input.addEventListener('change', async () => {
        const files = [...(input.files ?? [])];
        input.value = '';
        if (files.length) await this.processFiles(files);
      });
    }
  }

  open() {
    const { site } = this.getContext();
    if (!site) {
      showToast('Seleziona prima un cantiere.', { type: 'warning' });
      return;
    }
    this.resetProgress();
    openDialog(this.dialog);
  }

  resetProgress() {
    this.progressWrap.hidden = true;
    this.progress.value = 0;
    this.progress.max = 1;
    this.progressText.textContent = '';
  }

  setProcessing(value) {
    this.processing = value;
    for (const button of [this.photoButton, this.videoButton, this.galleryButton, this.closeButton]) {
      button.disabled = value;
    }
    this.progressWrap.hidden = !value;
  }

  async checkStorage(files) {
    const estimate = await getStorageEstimate();
    if (!estimate?.quota) return;
    const requested = files.reduce((sum, file) => sum + (file.size || 0), 0);
    if (requested > estimate.available) {
      throw new Error(
        `Spazio insufficiente. Servono ${formatBytes(requested)}, disponibili circa ${formatBytes(estimate.available)}.`,
      );
    }
  }

  async processFiles(files) {
    if (this.processing) return;
    const { site, user } = this.getContext();
    if (!site || !user) {
      showToast('Cantiere o utente non valido.', { type: 'error' });
      return;
    }

    this.setProcessing(true);
    this.progress.max = files.length;
    this.progress.value = 0;
    const saved = [];
    const errors = [];

    try {
      await this.checkStorage(files);
      await requestPersistentStorage();
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        this.progressText.textContent = `${index + 1} di ${files.length}: ${file.name}`;
        try {
          saved.push(await saveMediaFile(file, site, user));
        } catch (error) {
          errors.push({ file, error });
        }
        this.progress.value = index + 1;
      }
    } catch (error) {
      errors.push({ file: null, error });
    } finally {
      this.setProcessing(false);
    }

    if (saved.length) {
      closeDialog(this.dialog);
      showToast(
        saved.length === 1 ? 'Media salvato.' : `${saved.length} media salvati.`,
        { type: 'success' },
      );
      await this.onUploaded?.(saved);
    }
    if (errors.length) {
      const first = errors[0].error?.message ?? 'Errore di caricamento.';
      const suffix = errors.length > 1 ? ` Altri errori: ${errors.length - 1}.` : '';
      showToast(`${first}${suffix}`, { type: 'error', duration: 6000 });
    }
  }
}
