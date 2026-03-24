import test from 'node:test';
import assert from 'node:assert/strict';
import type { TerminalTab } from '../../shared/types.js';
import { createStatusBar } from '../components/StatusBar.js';
import { addTab, setState, setTabRuntimeState } from '../state/store.js';

type FakeClickable = { onclick: ((this: GlobalEventHandlers, ev: MouseEvent) => any) | null };

class FakeElement {
  className = '';
  innerHTML = '';
  private waitingEl: FakeClickable | null = null;

  querySelector(selector: string): FakeClickable | null {
    if (selector !== '.status-waiting') return null;
    if (!this.waitingEl) this.waitingEl = { onclick: null };
    return this.waitingEl;
  }
}

function resetStore(): void {
  setState({
    configs: [],
    selectedConfigId: null,
    tabs: [],
    activeTabId: null,
    sidebarVisible: true,
    sidebarWidth: 260,
    searchQuery: '',
    fontSize: 14,
    groups: [],
    runtimeStatesByTabId: {},
    protocolMetrics: null,
  });
}

function makeTab(id: string, status: TerminalTab['status']): TerminalTab {
  return {
    id,
    configId: 'cfg-1',
    configName: 'Config 1',
    configColor: '#123456',
    provider: 'codex',
    status,
  };
}

test('status bar renders counts with exited precedence over stale runtime state', () => {
  resetStore();

  const fakeDocument = {
    createElement: () => new FakeElement(),
  } as unknown as Document;
  const previousDocument = (globalThis as any).document;
  (globalThis as any).document = fakeDocument;

  try {
    addTab(makeTab('tab-running', 'running'));
    addTab(makeTab('tab-exited', 'exited'));
    setState({ activeTabId: 'tab-running' });

    setTabRuntimeState('tab-running', {
      state: 'running',
      confidence: 'high',
      reason: 'active work',
      source: 'explicit',
      updatedAt: Date.now(),
    });
    setTabRuntimeState('tab-exited', {
      state: 'idle',
      confidence: 'high',
      reason: 'stale idle snapshot',
      source: 'explicit',
      updatedAt: Date.now(),
    });

    const bar = createStatusBar(() => {});
    const html = (bar as unknown as FakeElement).innerHTML;
    assert.match(html, /R:1/);
    assert.match(html, /I:0/);
    assert.match(html, /X:1/);
  } finally {
    (globalThis as any).document = previousDocument;
  }
});
