import type { AppSettings } from '../../shared/types.js';

export interface PreferencesEditorResult {
  useWebglRenderer: boolean;
  restoreOnLaunch: boolean;
  restorePromptOnLaunch: boolean;
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
      <button class="btn btn-icon modal-close-btn">✕</button>
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
        <div class="form-group">
          <label>
            <input type="checkbox" id="pref-restore-on-launch" ${settings.restoreOnLaunch !== false ? 'checked' : ''} />
            Restore last workspace on launch
          </label>
          <div class="form-help">Reopens terminal tabs from your previous session using the same configs.</div>
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" id="pref-restore-prompt-on-launch" ${settings.restorePromptOnLaunch !== false ? 'checked' : ''} />
            Ask before restoring workspace
          </label>
          <div class="form-help">If enabled, MultiClaude asks for confirmation on startup before restoring tabs.</div>
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

  const webglCheckbox = modal.querySelector('#pref-use-webgl-renderer') as HTMLInputElement;
  const restoreOnLaunchCheckbox = modal.querySelector('#pref-restore-on-launch') as HTMLInputElement;
  const restorePromptOnLaunchCheckbox = modal.querySelector('#pref-restore-prompt-on-launch') as HTMLInputElement;

  const syncRestorePromptEnabled = () => {
    restorePromptOnLaunchCheckbox.disabled = !restoreOnLaunchCheckbox.checked;
  };
  restoreOnLaunchCheckbox.addEventListener('change', syncRestorePromptEnabled);
  syncRestorePromptEnabled();

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
      restoreOnLaunch: restoreOnLaunchCheckbox.checked,
      restorePromptOnLaunch: restorePromptOnLaunchCheckbox.checked,
    });
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      cleanup();
      onCancel();
    }
  }
  document.addEventListener('keydown', handleKeydown);
  setTimeout(() => webglCheckbox.focus(), 50);

  function cleanup() {
    document.removeEventListener('keydown', handleKeydown);
    overlay.remove();
  }
}
