interface DialogA11yOptions {
  modal: HTMLElement;
  onEscape: () => void;
}

export function setupDialogA11y(options: DialogA11yOptions): () => void {
  const { modal, onEscape } = options;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const title = modal.querySelector('.modal-header h2') as HTMLElement | null;
  if (title) {
    if (!title.id) {
      title.id = `modal-title-${Math.random().toString(36).slice(2, 10)}`;
    }
    modal.setAttribute('aria-labelledby', title.id);
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onEscape();
      return;
    }
    if (e.key !== 'Tab') return;

    const focusable = getFocusable(modal);
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (e.shiftKey) {
      if (!active || active === first || !modal.contains(active)) {
        e.preventDefault();
        last.focus();
      }
      return;
    }
    if (!active || active === last || !modal.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  };

  document.addEventListener('keydown', onKeyDown);

  return () => {
    document.removeEventListener('keydown', onKeyDown);
  };
}

function getFocusable(root: HTMLElement): HTMLElement[] {
  const selector = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  return Array.from(root.querySelectorAll(selector))
    .filter((el) => {
      const node = el as HTMLElement;
      if (node.hasAttribute('hidden')) return false;
      if (node.getAttribute('aria-hidden') === 'true') return false;
      return true;
    }) as HTMLElement[];
}
