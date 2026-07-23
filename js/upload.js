import { requestPersistentStorage, saveMediaFile } from './media.js?v=1.6.0';
import { closeDialog, openDialog, showToast } from './ui.js?v=1.6.0';

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
    directButtons = [],
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
      directButtons,
      getContext,
      onUploaded,
    });
    this.processing = false;
    this.bindEvents();
  }

  bindEvents() {
    this.photoButton.addEventListener('click', () => this.startPhotoCapture());
    this.videoButton.addEventListener('click', () => this.startVideoCapture());
    this.galleryButton.addEventListener('click', () => this.startGalleryImport());
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
    if (!this.validateContext()) return;
    this.resetProgress();
    openDialog(this.dialog);
  }

  validateContext() {
    const { site, user } = this.getContext();
    if (!site) {
      showToast('Seleziona prima il cantiere di destinazione.', { type: 'warning' });
      return false;
    }
    if (!user) {
      showToast('Utente non valido.', { type: 'error' });
      return false;
    }
    return true;
  }

  startInput(input) {
    if (this.processing || !this.validateContext()) return false;
    this.resetProgress();
    input.click();
    return true;
  }

  startPhotoCapture() {
    return this.startInput(this.photoInput);
  }

  startVideoCapture() {
    return this.startInput(this.videoInput);
  }

  startGalleryImport() {
    return this.startInput(this.galleryInput);
  }

  resetProgress() {
    this.progressWrap.hidden = true;
    this.progress.value = 0;
    this.progress.max = 1;
    this.progressText.textContent = '';
  }

  setProcessing(value) {
    this.processing = value;
    for (const button of [
      this.photoButton,
      this.videoButton,
      this.galleryButton,
      this.closeButton,
      ...this.directButtons,
    ]) {
      button.disabled = value;
    }
    this.progressWrap.hidden = !value;
  }


  async processFiles(files) {
    if (this.processing) return;
    const { site, user } = this.getContext();
    if (!site || !user) {
      showToast('Cantiere o utente non valido.', { type: 'error' });
      return;
    }

    if (!this.dialog.open) openDialog(this.dialog);
    this.setProcessing(true);
    this.progress.max = files.length;
    this.progress.value = 0;
    const saved = [];
    const duplicates = [];
    const errors = [];

    try {
      await requestPersistentStorage();
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        this.progressText.textContent = `${index + 1} di ${files.length}: ${file.name}`;
        try {
          saved.push(await saveMediaFile(file, site, user));
        } catch (error) {
          if (error?.code === 'DUPLICATE_MEDIA') duplicates.push({ file, error });
          else errors.push({ file, error });
        }
        this.progress.value = index + 1;
      }
    } catch (error) {
      errors.push({ file: null, error });
    } finally {
      this.setProcessing(false);
    }

    if (saved.length || duplicates.length) closeDialog(this.dialog);

    if (saved.length) await this.onUploaded?.(saved);

    if (saved.length || duplicates.length) {
      const messages = [];
      if (saved.length) {
        messages.push(saved.length === 1 ? 'Media salvato.' : `${saved.length} media salvati.`);
      }
      if (duplicates.length) {
        messages.push(
          duplicates.length === 1
            ? '1 duplicato ignorato.'
            : `${duplicates.length} duplicati ignorati.`,
        );
      }
      showToast(messages.join(' '), {
        type: saved.length ? 'success' : 'warning',
        duration: duplicates.length ? 6000 : 3500,
      });
    }

    if (errors.length) {
      const first = errors[0].error?.message ?? 'Errore di caricamento.';
      const suffix = errors.length > 1 ? ` Altri errori: ${errors.length - 1}.` : '';
      showToast(`${first}${suffix}`, { type: 'error', duration: 6000 });
    }
  }
}
