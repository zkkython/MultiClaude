import test from 'node:test';
import assert from 'node:assert/strict';
import type { TerminalTab } from '../../shared/types.js';
import {
  addTab,
  getRuntimeStateCounts,
  setState,
  setTabRuntimeState,
} from '../state/store.js';

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
    useWebglRenderer: false,
    restoreOnLaunch: true,
    restorePromptOnLaunch: true,
    worktreeRecentRepoPaths: [],
    worktreeDefaultTargetRef: 'main',
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

test('counts exited tab as exited even if stale runtime state says idle', () => {
  resetStore();

  addTab(makeTab('tab-running', 'running'));
  addTab(makeTab('tab-exited', 'exited'));

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

  const counts = getRuntimeStateCounts();
  assert.equal(counts.running, 1);
  assert.equal(counts.idle, 0);
  assert.equal(counts.exited, 1);
});
