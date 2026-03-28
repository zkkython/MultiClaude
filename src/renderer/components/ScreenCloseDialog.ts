import { setupDialogA11y } from './modal-a11y.js';

export type ScreenCloseDialogAction = 'cancel' | 'close' | 'clear';

export function showScreenCloseDialog(input: {
  screenId: string;
  screenName: string;
  tabCount: number;
}): Promise<ScreenCloseDialogAction> {
  const oldModal = document.querySelector('.modal-overlay');
  if (oldModal) oldModal.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal screen-close-dialog';
  modal.innerHTML = `
    <div class="modal-header">
      <h2>Close Screen</h2>
      <button class="btn btn-icon modal-close-btn" aria-label="Close dialog">✕</button>
    </div>
    <div class="modal-body">
      <div class="screen-close-meta">Screen: <code>${escapeHtml(input.screenId)}</code> · ${escapeHtml(input.screenName)}</div>
      <div class="screen-close-desc">Tabs in this screen: ${input.tabCount}</div>
      <div class="screen-close-hint">Choose whether to close only for this session, or also clear persisted screen settings.</div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" id="screen-close-cancel">Cancel</button>
      <button class="btn btn-primary" id="screen-close-session">Close (Session Only)</button>
      <button class="btn btn-danger" id="screen-close-clear">Close + Clear Saved Data</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  return new Promise<ScreenCloseDialogAction>((resolve) => {
    const teardownDialogA11y = setupDialogA11y({
      modal,
      onEscape: () => settle('cancel'),
    });

    const settle = (action: ScreenCloseDialogAction) => {
      cleanup();
      resolve(action);
    };

    modal.querySelector('.modal-close-btn')?.addEventListener('click', () => settle('cancel'));
    modal.querySelector('#screen-close-cancel')?.addEventListener('click', () => settle('cancel'));
    modal.querySelector('#screen-close-session')?.addEventListener('click', () => settle('close'));
    modal.querySelector('#screen-close-clear')?.addEventListener('click', () => settle('clear'));

    function cleanup() {
      teardownDialogA11y();
      overlay.remove();
    }
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
