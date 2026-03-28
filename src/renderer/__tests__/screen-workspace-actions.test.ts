import test from 'node:test';
import assert from 'node:assert/strict';
import type { TerminalTab } from '../../shared/types.js';
import {
  addTab,
  getScreens,
  getState,
  setState,
  setScreenLayout,
} from '../state/store.js';
import {
  createGroupFromTabAction,
  moveTabToExistingScreenAction,
  moveTabToNewScreenAction,
  renameGroupInlineAction,
} from '../components/ScreenWorkspace.js';

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
    worktreeRecentRepoPaths: [],
    worktreeDefaultTargetRef: 'main',
    groups: [],
    runtimeStatesByTabId: {},
    protocolMetrics: null,
    screens: [{ id: 'screen-a', name: 'Screen A', tabs: [], activeTabId: null, groups: [] }],
    activeScreenId: 'screen-a',
  });
}

function makeTab(id: string, status: TerminalTab['status']): TerminalTab {
  return {
    id,
    terminalId: `term-${id}`,
    configId: 'cfg-1',
    configName: 'Config 1',
    configColor: '#4A90D9',
    provider: 'codex',
    status,
  };
}

test('Move To New Screen action creates screen and focuses moved tab', () => {
  resetStore();
  let changed = 0;
  addTab(makeTab('tab-1', 'running'));
  addTab(makeTab('tab-2', 'running'));

  const target = moveTabToNewScreenAction('tab-2', () => { changed += 1; });
  assert.ok(target);
  assert.equal(changed, 1);

  const state = getState();
  assert.equal(state.activeScreenId, target);
  assert.equal(state.activeTabId, 'tab-2');
  const screens = getScreens();
  assert.equal(screens.length, 2);
  assert.deepEqual(screens.find(s => s.id === 'screen-a')?.tabs.map(t => t.id), ['tab-1']);
  assert.deepEqual(screens.find(s => s.id === target)?.tabs.map(t => t.id), ['tab-2']);
});

test('Move To New Screen action returns null when already at max screens', () => {
  resetStore();
  setScreenLayout([
    { id: 'screen-a', name: 'Screen A' },
    { id: 'screen-b', name: 'Screen B' },
    { id: 'screen-c', name: 'Screen C' },
    { id: 'screen-d', name: 'Screen D' },
  ], 'screen-a');
  let changed = 0;
  addTab(makeTab('tab-1', 'running'));
  const target = moveTabToNewScreenAction('tab-1', () => { changed += 1; });
  assert.equal(target, null);
  assert.equal(changed, 0);
  assert.equal(getScreens().length, 4);
});

test('Move To Screen action moves tab to existing screen and focuses target', () => {
  resetStore();
  setScreenLayout([
    { id: 'screen-a', name: 'Screen A' },
    { id: 'screen-b', name: 'Screen B' },
  ], 'screen-a');
  let changed = 0;

  addTab(makeTab('tab-1', 'running'));
  const ok = moveTabToExistingScreenAction('tab-1', 'screen-b', () => { changed += 1; });
  assert.equal(ok, true);
  assert.equal(changed, 1);

  const state = getState();
  assert.equal(state.activeScreenId, 'screen-b');
  assert.equal(state.activeTabId, 'tab-1');
  assert.deepEqual(getScreens().find(s => s.id === 'screen-a')?.tabs.map(t => t.id), []);
  assert.deepEqual(getScreens().find(s => s.id === 'screen-b')?.tabs.map(t => t.id), ['tab-1']);
});

test('Move To Screen action rejects unknown target and does not trigger callbacks', () => {
  resetStore();
  let changed = 0;
  addTab(makeTab('tab-1', 'running'));
  const ok = moveTabToExistingScreenAction('tab-1', 'screen-z', () => { changed += 1; });
  assert.equal(ok, false);
  assert.equal(changed, 0);
  assert.equal(getState().activeScreenId, 'screen-a');
});

test('New Group action creates group with selected tab member', () => {
  resetStore();
  let changed = 0;
  addTab(makeTab('tab-1', 'running'));

  const groupId = createGroupFromTabAction('screen-a', 'tab-1', () => { changed += 1; });
  assert.equal(changed, 1);
  const group = getScreens()[0].groups.find(g => g.id === groupId);
  assert.ok(group);
  assert.deepEqual(group?.tabIds, ['tab-1']);
  assert.deepEqual(group?.associatedConfigIds, ['cfg-1']);
});

test('New Group action honors explicit name input', () => {
  resetStore();
  addTab(makeTab('tab-1', 'running'));
  const groupId = createGroupFromTabAction('screen-a', 'tab-1', () => {}, 'Plan');
  const group = getScreens()[0].groups.find(g => g.id === groupId);
  assert.equal(group?.name, 'Plan');
});

test('New Group action falls back to defaults when tab is missing', () => {
  resetStore();
  let changed = 0;
  const groupId = createGroupFromTabAction('screen-a', 'missing-tab', () => { changed += 1; });
  const group = getScreens()[0].groups.find(g => g.id === groupId);
  assert.ok(group);
  assert.equal(group?.name, 'New Group');
  assert.deepEqual(group?.tabIds, []);
  assert.deepEqual(group?.associatedConfigIds, []);
  assert.equal(changed, 1);
});

test('Rename Group inline action commits non-empty name and rejects blank value', () => {
  resetStore();
  let changed = 0;
  addTab(makeTab('tab-1', 'running'));
  const groupId = createGroupFromTabAction('screen-a', 'tab-1', () => { changed += 1; });

  const rejected = renameGroupInlineAction('screen-a', groupId, '   ', () => { changed += 1; });
  assert.equal(rejected, false);

  const committed = renameGroupInlineAction('screen-a', groupId, 'Core', () => { changed += 1; });
  assert.equal(committed, true);
  const group = getScreens()[0].groups.find(g => g.id === groupId);
  assert.equal(group?.name, 'Core');
  assert.equal(changed, 2);
});
