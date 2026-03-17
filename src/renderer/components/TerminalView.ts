import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { getState } from '../state/store.js';

interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  container: HTMLElement;
  terminalId: string;
}

const instances = new Map<string, TerminalInstance>();

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
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#f5e0dc',
      selectionBackground: '#585b7066',
      black: '#45475a',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      magenta: '#f5c2e7',
      cyan: '#94e2d5',
      white: '#bac2de',
      brightBlack: '#585b70',
      brightRed: '#f38ba8',
      brightGreen: '#a6e3a1',
      brightYellow: '#f9e2af',
      brightBlue: '#89b4fa',
      brightMagenta: '#f5c2e7',
      brightCyan: '#94e2d5',
      brightWhite: '#a6adc8',
    },
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());

  terminal.open(container);

  // Try WebGL addon (falls back gracefully)
  try {
    terminal.loadAddon(new WebglAddon());
  } catch {
    // WebGL not supported, fall back to canvas renderer
  }

  // Wire data to PTY
  terminal.onData((data) => {
    window.multiclaude.terminal.write(terminalId, data);
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

  instances.set(tabId, { terminal, fitAddon, container, terminalId });

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
      instance.fitAddon.fit();
      instance.terminal.focus();
    });
  }
}

export function destroyTerminal(tabId: string): void {
  const instance = instances.get(tabId);
  if (instance) {
    instance.terminal.dispose();
    instance.container.remove();
    instances.delete(tabId);
  }
}

export function fitAllTerminals(): void {
  for (const inst of instances.values()) {
    if (inst.container.style.display !== 'none') {
      inst.fitAddon.fit();
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
