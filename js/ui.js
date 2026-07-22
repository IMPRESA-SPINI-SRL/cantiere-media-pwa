import { escapeHtml } from './utils.js?v=1.4.1';

export function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Elemento non trovato: ${id}`);
  return element;
}

export function setHidden(element, hidden) {
  element.hidden = hidden;
}

export function openDialog(dialog) {
  if (typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
    dialog.classList.add('dialog-fallback-open');
  }
}

export function closeDialog(dialog, returnValue = '') {
  if (typeof dialog.close === 'function' && dialog.open) {
    dialog.close(returnValue);
  } else {
    dialog.removeAttribute('open');
    dialog.classList.remove('dialog-fallback-open');
  }
}

let toastTimer = null;

export function showToast(message, { type = 'info', duration = 3200 } = {}) {
  const toast = byId('toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.dataset.type = type;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  toastTimer = setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => {
      toast.hidden = true;
    }, 180);
  }, duration);
}

export function setBusy(isBusy, message = 'Operazione in corso...') {
  const overlay = byId('busy-overlay');
  byId('busy-message').textContent = message;
  overlay.hidden = !isBusy;
}

function createConfirmDialog() {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal confirm-dialog';
  dialog.innerHTML = `
    <div class="modal-card">
      <h2 data-confirm-title></h2>
      <p data-confirm-message></p>
      <label class="field confirm-required" hidden>
        <span data-confirm-input-label></span>
        <input data-confirm-input autocomplete="off">
      </label>
      <div class="modal-actions">
        <button type="button" class="button button-text" data-confirm-cancel>Annulla</button>
        <button type="button" class="button button-primary" data-confirm-ok>Conferma</button>
      </div>
    </div>`;
  document.body.append(dialog);
  return dialog;
}

export function confirmAction({
  title = 'Conferma',
  message = '',
  confirmText = 'Conferma',
  cancelText = 'Annulla',
  danger = false,
  requiredText = null,
  inputLabel = '',
  hideCancel = false,
} = {}) {
  const dialog = createConfirmDialog();
  const titleElement = dialog.querySelector('[data-confirm-title]');
  const messageElement = dialog.querySelector('[data-confirm-message]');
  const requiredField = dialog.querySelector('.confirm-required');
  const input = dialog.querySelector('[data-confirm-input]');
  const inputLabelElement = dialog.querySelector('[data-confirm-input-label]');
  const confirmButton = dialog.querySelector('[data-confirm-ok]');
  const cancelButton = dialog.querySelector('[data-confirm-cancel]');

  titleElement.textContent = title;
  messageElement.textContent = message;
  confirmButton.textContent = confirmText;
  cancelButton.textContent = cancelText;
  cancelButton.hidden = hideCancel;
  confirmButton.classList.toggle('button-danger', danger);
  confirmButton.classList.toggle('button-primary', !danger);

  if (requiredText != null) {
    requiredField.hidden = false;
    inputLabelElement.textContent = inputLabel || `Scrivi: ${requiredText}`;
    confirmButton.disabled = true;
    input.addEventListener('input', () => {
      confirmButton.disabled = input.value.trim() !== requiredText;
    });
  }

  return new Promise((resolve) => {
    const finish = (result) => {
      closeDialog(dialog);
      dialog.remove();
      resolve(result);
    };
    confirmButton.addEventListener('click', () => finish(true), { once: true });
    cancelButton.addEventListener('click', () => finish(false), { once: true });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    }, { once: true });
    openDialog(dialog);
    if (requiredText != null) setTimeout(() => input.focus(), 0);
  });
}

export async function showAlert({ title = 'Avviso', message = '', buttonText = 'OK' } = {}) {
  await confirmAction({
    title,
    message,
    confirmText: buttonText,
    hideCancel: true,
  });
}

export function renderError(container, error) {
  container.innerHTML = `<p class="error-message">${escapeHtml(error?.message ?? String(error))}</p>`;
}
