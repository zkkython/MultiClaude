import type { PreflightIssue, PreflightFixAction } from '../preflight.js';
import { setupDialogA11y } from './modal-a11y.js';

export type PreflightDialogAction =
  | 'cancel'
  | 'continue'
  | 'edit-config'
  | 'install-claude-hooks'
  | 'set-transport-pty'
  | 'clear-headers-json';

export function showPreflightDialog(input: {
  configName: string;
  issues: PreflightIssue[];
}): Promise<PreflightDialogAction> {
  const oldModal = document.querySelector('.modal-overlay');
  if (oldModal) oldModal.remove();

  const blockers = input.issues.filter(item => item.severity === 'blocker');
  const warnings = input.issues.filter(item => item.severity === 'warning');
  const fixActions = new Set<PreflightFixAction>(input.issues.map(item => item.fixAction).filter(Boolean) as PreflightFixAction[]);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal preflight-dialog';
  modal.innerHTML = `
    <div class="modal-header">
      <h2>Preflight Check · ${escapeHtml(input.configName)}</h2>
      <button class="btn btn-icon modal-close-btn">✕</button>
    </div>
    <div class="modal-body">
      ${blockers.length > 0 ? `
        <div class="form-group">
          <label>Blocking issues</label>
          <ul>${blockers.map(item => `<li>${escapeHtml(item.message)}</li>`).join('')}</ul>
        </div>
      ` : ''}
      ${warnings.length > 0 ? `
        <div class="form-group">
          <label>Warnings</label>
          <ul>${warnings.map(item => `<li>${escapeHtml(item.message)}</li>`).join('')}</ul>
        </div>
      ` : ''}
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" id="preflight-cancel">Cancel</button>
      ${fixActions.has('edit-config') ? '<button class="btn btn-secondary" id="preflight-edit">Edit Config</button>' : ''}
      ${fixActions.has('install-claude-hooks') ? '<button class="btn btn-secondary" id="preflight-install-hooks">Install Hooks</button>' : ''}
      ${fixActions.has('set-transport-pty') ? '<button class="btn btn-secondary" id="preflight-fix-transport">Set Transport=pty</button>' : ''}
      ${fixActions.has('clear-headers-json') ? '<button class="btn btn-secondary" id="preflight-clear-headers">Clear Headers JSON</button>' : ''}
      ${blockers.length === 0 ? '<button class="btn btn-primary" id="preflight-continue">Continue</button>' : ''}
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  return new Promise<PreflightDialogAction>((resolve) => {
    const teardownDialogA11y = setupDialogA11y({
      modal,
      onEscape: () => settle('cancel'),
    });

    const settle = (action: PreflightDialogAction) => {
      cleanup();
      resolve(action);
    };

    modal.querySelector('.modal-close-btn')?.addEventListener('click', () => settle('cancel'));
    modal.querySelector('#preflight-cancel')?.addEventListener('click', () => settle('cancel'));
    modal.querySelector('#preflight-continue')?.addEventListener('click', () => settle('continue'));
    modal.querySelector('#preflight-edit')?.addEventListener('click', () => settle('edit-config'));
    modal.querySelector('#preflight-install-hooks')?.addEventListener('click', () => settle('install-claude-hooks'));
    modal.querySelector('#preflight-fix-transport')?.addEventListener('click', () => settle('set-transport-pty'));
    modal.querySelector('#preflight-clear-headers')?.addEventListener('click', () => settle('clear-headers-json'));

    function cleanup() {
      teardownDialogA11y();
      overlay.remove();
    }
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
