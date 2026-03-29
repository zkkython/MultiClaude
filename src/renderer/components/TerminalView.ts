import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { getState } from '../state/store.js';
import { shouldAutoFocusTerminal } from './terminal-focus-guard.js';

interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  webglAddon: WebglAddon | null;
  container: HTMLElement;
  terminalId: string;
}

const instances = new Map<string, TerminalInstance>();
let menuShortcutsIgnored = false;
const FORCE_LINE_NAV_STEPS = 256;

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function resolveTerminalTheme() {
  return {
    background: cssVar('--bg-base', '#0f1115'),
    foreground: cssVar('--text', '#e6eaf2'),
    cursor: cssVar('--amber-strong', '#dbb367'),
    selectionBackground: cssVar('--terminal-selection-bg', 'rgba(201, 154, 61, 0.28)'),
    black: cssVar('--bg-surface1', '#263043'),
    red: cssVar('--red', '#cc5a5a'),
    green: cssVar('--green', '#4fae74'),
    yellow: cssVar('--yellow', '#d2a24c'),
    blue: cssVar('--blue', '#6f9ed8'),
    magenta: cssVar('--mauve', '#8b83b4'),
    cyan: cssVar('--teal', '#4fa59a'),
    white: cssVar('--text-dim', '#9aa4b5'),
    brightBlack: cssVar('--text-muted', '#7a89a1'),
    brightRed: cssVar('--red', '#cc5a5a'),
    brightGreen: cssVar('--green', '#4fae74'),
    brightYellow: cssVar('--yellow', '#d2a24c'),
    brightBlue: cssVar('--blue', '#6f9ed8'),
    brightMagenta: cssVar('--mauve', '#8b83b4'),
    brightCyan: cssVar('--teal', '#4fa59a'),
    brightWhite: cssVar('--text', '#e6eaf2'),
  };
}

function isWebglOptInEnabled(): boolean {
  return getState().useWebglRenderer;
}

function attachOptionalWebglRenderer(terminal: Terminal): WebglAddon | null {
  if (!isWebglOptInEnabled()) return null;

  try {
    const addon = new WebglAddon();
    let disposed = false;

    const onContextLossDisposable = addon.onContextLoss(() => {
      if (disposed) return;
      disposed = true;
      console.warn('[xterm] WebGL context lost; falling back to canvas renderer.');
      onContextLossDisposable.dispose();
      addon.dispose();
    });

    terminal.onDispose(() => {
      if (disposed) return;
      disposed = true;
      onContextLossDisposable.dispose();
      addon.dispose();
    });

    terminal.loadAddon(addon);
    return addon;
  } catch (error) {
    console.warn('[xterm] WebGL renderer unavailable; using canvas renderer.', error);
    return null;
  }
}

export function createTerminalContainer(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'terminal-container';
  return container;
}

export function createTerminalView(
  parentContainer: HTMLElement,
  tabId: string,
  terminalId: string,
  configColor: string,
): void {
  const container = document.createElement('div');
  container.className = 'terminal-view';
  container.id = `terminal-${tabId}`;
  container.style.display = 'none';
  container.style.borderTopColor = configColor;
  parentContainer.appendChild(container);

  const state = getState();
  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: state.fontSize,
    fontFamily: '"SF Mono", Menlo, Monaco, "Cascadia Mono", "JetBrains Mono", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans Mono CJK SC", "Courier New", monospace',
    customGlyphs: false,
    theme: resolveTerminalTheme(),
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());

  terminal.open(container);

  // Default renderer is canvas; WebGL is opt-in and auto-falls-back on context loss.
  const webglAddon = attachOptionalWebglRenderer(terminal);

  // Wire data to PTY
  terminal.onData((data) => {
    window.multiclaude.terminal.write(terminalId, normalizeCaretControlNotation(data));
  });

  // Some host/input stacks can surface Ctrl combinations as caret notation
  // (e.g. "^A", "^E"). Force canonical control bytes for line navigation keys.
  terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
    if (event.type === 'keydown' && document.querySelector('.screen-workspace[data-inline-editing="1"]')) {
      // During inline rename, never let terminal consume keystrokes.
      return false;
    }
    if (event.type !== 'keydown') return true;
    if (!event.ctrlKey || event.metaKey || event.altKey) return true;
    const key = event.key.toLowerCase();
    if (key === 'a') {
      // Hard fallback: move cursor to start by repeated Left key strokes.
      window.multiclaude.terminal.write(terminalId, '\x1b[D'.repeat(FORCE_LINE_NAV_STEPS));
      return false;
    }
    if (key === 'e') {
      // Hard fallback: move cursor to end by repeated Right key strokes.
      window.multiclaude.terminal.write(terminalId, '\x1b[C'.repeat(FORCE_LINE_NAV_STEPS));
      return false;
    }
    return true;
  });

  // Wire resize to PTY
  terminal.onResize(({ cols, rows }) => {
    window.multiclaude.terminal.resize(terminalId, cols, rows);
  });

  // Right-click context menu
  container.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.multiclaude.contextMenu.show(terminalId, terminal.hasSelection());
  });

  // When terminal owns focus, allow shell/CLI shortcuts to pass through instead
  // of being intercepted by Electron menu accelerators.
  container.addEventListener('focusin', () => {
    void setIgnoreMenuShortcuts(true);
  });
  container.addEventListener('focusout', () => {
    requestAnimationFrame(() => {
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl && container.contains(activeEl)) return;
      void setIgnoreMenuShortcuts(false);
    });
  });

  instances.set(tabId, { terminal, fitAddon, webglAddon, container, terminalId });

  // Initial fit
  requestAnimationFrame(() => {
    fitAddon.fit();
  });
}

export function writeToTerminal(tabId: string, data: string): void {
  const instance = instances.get(tabId);
  if (instance) {
    instance.terminal.write(data);
  }
}

export function showTerminal(tabId: string): void {
  // Hide all
  for (const [id, inst] of instances) {
    inst.container.style.display = id === tabId ? 'block' : 'none';
  }
  // Fit the shown terminal
  const instance = instances.get(tabId);
  if (instance) {
    requestAnimationFrame(() => {
      focusTerminalWithRetry(instance);
    });
  }
}

export function showTerminals(
  visibleTabIds: Set<string>,
  focusedTabId?: string | null,
  shouldFocus = true,
): void {
  for (const [tabId, inst] of instances) {
    const visible = visibleTabIds.has(tabId);
    inst.container.style.display = visible ? 'block' : 'none';
  }
  if (!focusedTabId) {
    fitAllTerminals();
    return;
  }
  const focused = instances.get(focusedTabId);
  if (!focused || focused.container.style.display === 'none') {
    fitAllTerminals();
    return;
  }
  requestAnimationFrame(() => {
    if (shouldAutoFocusTerminal(shouldFocus)) {
      focusTerminalWithRetry(focused);
      return;
    }
    focused.fitAddon.fit();
  });
}

export function mountTerminalToHost(tabId: string, host: HTMLElement): void {
  const instance = instances.get(tabId);
  if (!instance) return;
  if (instance.container.parentElement !== host) {
    host.appendChild(instance.container);
  }
}

export function destroyTerminal(tabId: string): void {
  const instance = instances.get(tabId);
  if (instance) {
    instance.webglAddon?.dispose();
    instance.terminal.dispose();
    instance.container.remove();
    instances.delete(tabId);
    if (instances.size === 0) {
      void setIgnoreMenuShortcuts(false);
    }
  }
}

export function fitAllTerminals(): void {
  for (const inst of instances.values()) {
    if (inst.container.style.display !== 'none') {
      inst.fitAddon.fit();
    }
  }
}

export function blurAllTerminals(): void {
  for (const inst of instances.values()) {
    try {
      inst.terminal.blur();
    } catch {
      // noop
    }
  }
}

export function repaintVisibleTerminals(): void {
  for (const inst of instances.values()) {
    if (inst.container.style.display === 'none') continue;
    try {
      inst.fitAddon.fit();
      const rows = Math.max(inst.terminal.rows - 1, 0);
      inst.terminal.refresh(0, rows);
    } catch (err) {
      console.warn('[xterm] repaint failed:', err);
    }
  }
}

export function getTerminalIdForTab(tabId: string): string | undefined {
  return instances.get(tabId)?.terminalId;
}

export function clearTerminal(tabId: string): void {
  const instance = instances.get(tabId);
  if (instance) {
    instance.terminal.clear();
  }
}

export function selectAllInTerminal(tabId: string): void {
  const instance = instances.get(tabId);
  if (instance) {
    instance.terminal.selectAll();
  }
}

export function copyFromTerminal(tabId: string): void {
  const instance = instances.get(tabId);
  if (instance && instance.terminal.hasSelection()) {
    navigator.clipboard.writeText(instance.terminal.getSelection());
  }
}

export function pasteToTerminal(tabId: string): void {
  const instance = instances.get(tabId);
  if (instance) {
    navigator.clipboard.readText().then(text => {
      window.multiclaude.terminal.write(instance.terminalId, text);
    });
  }
}

export function setTerminalFontSize(size: number): void {
  for (const inst of instances.values()) {
    inst.terminal.options.fontSize = size;
    inst.fitAddon.fit();
  }
}

// Handle window resize
window.addEventListener('resize', () => {
  fitAllTerminals();
});

window.addEventListener('focus', () => {
  repaintVisibleTerminals();
});

window.addEventListener('blur', () => {
  void setIgnoreMenuShortcuts(false);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    repaintVisibleTerminals();
    return;
  }
  void setIgnoreMenuShortcuts(false);
});

async function setIgnoreMenuShortcuts(ignore: boolean): Promise<void> {
  if (menuShortcutsIgnored === ignore) return;
  menuShortcutsIgnored = ignore;
  try {
    await window.multiclaude.app.setIgnoreMenuShortcuts(ignore);
  } catch (err) {
    console.warn('Failed to toggle menu shortcut passthrough:', err);
  }
}

function focusTerminalWithRetry(instance: TerminalInstance): void {
  const tryFocus = (attempt: number) => {
    instance.fitAddon.fit();
    instance.terminal.focus();
    requestAnimationFrame(() => {
      const activeEl = document.activeElement as HTMLElement | null;
      const focused = Boolean(activeEl && instance.container.contains(activeEl));
      if (focused || attempt >= 2) return;
      setTimeout(() => tryFocus(attempt + 1), 0);
    });
  };
  tryFocus(0);
}

function normalizeCaretControlNotation(data: string): string {
  // Conservative fallback: only normalize chunks that are fully composed of
  // caret-control pairs, e.g. "^A" or "^A^E^A".
  if (!data || data.length < 2 || data.length % 2 !== 0) return data;
  if (!/^(?:\^[\x3f\x40-\x5f])+$/.test(data)) return data;
  let normalized = '';
  for (let i = 0; i < data.length; i += 2) {
    const marker = data[i + 1];
    if (marker === '?') {
      normalized += '\x7f';
      continue;
    }
    normalized += String.fromCharCode(marker.charCodeAt(0) - 64);
  }
  return normalized;
}
