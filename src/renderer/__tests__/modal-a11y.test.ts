import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDialogA11y } from '../components/modal-a11y.js';

type KeyHandler = (ev: { key: string; shiftKey?: boolean; preventDefault: () => void }) => void;

class FakeFocusable {
  focused = false;
  private attrs: Record<string, string>;

  constructor(attrs: Record<string, string> = {}) {
    this.attrs = attrs;
  }

  hasAttribute(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.attrs, name);
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  focus(): void {
    this.focused = true;
  }
}

class FakeTitle {
  id: string;
  constructor(id = '') {
    this.id = id;
  }
}

class FakeModal {
  attributes: Record<string, string> = {};
  title: FakeTitle | null = null;
  focusables: FakeFocusable[] = [];

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  querySelector(selector: string): FakeTitle | null {
    if (selector === '.modal-header h2') return this.title;
    return null;
  }

  querySelectorAll(_selector: string): FakeFocusable[] {
    return this.focusables;
  }

  contains(node: unknown): boolean {
    return this.focusables.includes(node as FakeFocusable) || node === this.title;
  }
}

test('setupDialogA11y sets aria attributes and handles Escape', () => {
  const modal = new FakeModal();
  modal.title = new FakeTitle('title-1');

  let onKeyDown: KeyHandler | null = null;
  const fakeDocument = {
    activeElement: null,
    addEventListener: (_event: string, handler: KeyHandler) => { onKeyDown = handler; },
    removeEventListener: (_event: string, handler: KeyHandler) => {
      if (onKeyDown === handler) onKeyDown = null;
    },
  } as unknown as Document;
  const prev = (globalThis as any).document;
  (globalThis as any).document = fakeDocument;

  let escaped = 0;
  try {
    const cleanup = setupDialogA11y({
      modal: modal as unknown as HTMLElement,
      onEscape: () => { escaped += 1; },
    });

    assert.equal(modal.attributes.role, 'dialog');
    assert.equal(modal.attributes['aria-modal'], 'true');
    assert.equal(modal.attributes['aria-labelledby'], 'title-1');
    assert.ok(onKeyDown);

    let prevented = false;
    onKeyDown?.({ key: 'Escape', preventDefault: () => { prevented = true; } });
    assert.equal(escaped, 1);
    assert.equal(prevented, true);

    cleanup();
    assert.equal(onKeyDown, null);
  } finally {
    (globalThis as any).document = prev;
  }
});

test('tab trapping prevents default when no focusable elements exist', () => {
  const modal = new FakeModal();

  let onKeyDown: KeyHandler | null = null;
  const fakeDocument = {
    activeElement: null,
    addEventListener: (_event: string, handler: KeyHandler) => { onKeyDown = handler; },
    removeEventListener: () => {},
  } as unknown as Document;
  const prev = (globalThis as any).document;
  (globalThis as any).document = fakeDocument;

  try {
    setupDialogA11y({
      modal: modal as unknown as HTMLElement,
      onEscape: () => {},
    });

    let prevented = false;
    onKeyDown?.({ key: 'Tab', preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
  } finally {
    (globalThis as any).document = prev;
  }
});

test('tab trapping wraps focus forward and backward', () => {
  const modal = new FakeModal();
  const first = new FakeFocusable();
  const last = new FakeFocusable();
  modal.focusables = [first, last];

  let onKeyDown: KeyHandler | null = null;
  const fakeDocument = {
    activeElement: last,
    addEventListener: (_event: string, handler: KeyHandler) => { onKeyDown = handler; },
    removeEventListener: () => {},
  } as unknown as Document;
  const prev = (globalThis as any).document;
  (globalThis as any).document = fakeDocument;

  try {
    setupDialogA11y({
      modal: modal as unknown as HTMLElement,
      onEscape: () => {},
    });

    let preventedForward = false;
    onKeyDown?.({ key: 'Tab', preventDefault: () => { preventedForward = true; } });
    assert.equal(preventedForward, true);
    assert.equal(first.focused, true);

    (fakeDocument as any).activeElement = first;
    let preventedBackward = false;
    onKeyDown?.({ key: 'Tab', shiftKey: true, preventDefault: () => { preventedBackward = true; } });
    assert.equal(preventedBackward, true);
    assert.equal(last.focused, true);
  } finally {
    (globalThis as any).document = prev;
  }
});
