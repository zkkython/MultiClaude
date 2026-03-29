import type { AppSettings } from '../../shared/types.js';
import { setupDialogA11y } from './modal-a11y.js';

export interface PreferencesEditorResult {
  useWebglRenderer: boolean;
}

export function showPreferencesEditor(
  settings: AppSettings,
  onSave: (result: PreferencesEditorResult) => void,
  onCancel: () => void,
): void {
  const oldModal = document.querySelector('.modal-overlay');
  if (oldModal) oldModal.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal preferences-editor';

  modal.innerHTML = `
    <div class="modal-header">
      <h2>Preferences</h2>
      <button class="btn btn-icon modal-close-btn" aria-label="Close dialog">✕</button>
    </div>
    <div class="modal-body">
      <form id="preferences-form">
        <div class="form-group">
          <label>
            <input type="checkbox" id="pref-use-webgl-renderer" ${settings.useWebglRenderer ? 'checked' : ''} />
            Use WebGL terminal renderer (experimental)
          </label>
          <div class="form-help">Improves performance on some GPUs, but may cause long-session artifacts. Reopen terminals after changing this option.</div>
        </div>
      </form>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" id="preferences-cancel">Cancel</button>
      <button class="btn btn-primary" id="preferences-save">Save</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const teardownDialogA11y = setupDialogA11y({
    modal,
    onEscape: () => {
      cleanup();
      onCancel();
    },
  });

  const webglCheckbox = modal.querySelector('#pref-use-webgl-renderer') as HTMLInputElement;

  modal.querySelector('.modal-close-btn')!.addEventListener('click', () => {
    cleanup();
    onCancel();
  });
  modal.querySelector('#preferences-cancel')!.addEventListener('click', () => {
    cleanup();
    onCancel();
  });
  modal.querySelector('#preferences-save')!.addEventListener('click', () => {
    cleanup();
    onSave({
      useWebglRenderer: webglCheckbox.checked,
    });
  });

  setTimeout(() => webglCheckbox.focus(), 50);

  function cleanup() {
    teardownDialogA11y();
    overlay.remove();
  }
}
