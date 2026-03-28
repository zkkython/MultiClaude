import test from 'node:test';
import assert from 'node:assert/strict';
import type { TerminalTab } from '../../shared/types.js';
import {
  addTab,
  createGroup,
  findNextWaitingTabId,
  getScreens,
  getState,
  moveTabToGroup,
  getRuntimeStateCounts,
  getTabScreenId,
  moveTabToNewScreen,
  moveTabToScreen,
  removeTabFromGroup,
  removeScreen,
  removeTab,
  setState,
  reconcileTabsIntoAssociatedGroups,
  toggleGroupCollapse,
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

test('move tab to new screen keeps unique ownership', () => {
  resetStore();
  addTab(makeTab('tab-1', 'running'));
  addTab(makeTab('tab-2', 'running'));

  const targetScreenId = moveTabToNewScreen('tab-2');
  assert.ok(targetScreenId);
  assert.equal(getTabScreenId('tab-2'), targetScreenId);

  const screens = getScreens();
  assert.equal(screens.length, 2);
  const sourceTabs = screens.find(screen => screen.id === 'screen-a')?.tabs.map(tab => tab.id) || [];
  const targetTabs = screens.find(screen => screen.id === targetScreenId)?.tabs.map(tab => tab.id) || [];
  assert.deepEqual(sourceTabs, ['tab-1']);
  assert.deepEqual(targetTabs, ['tab-2']);
});

test('move tab across screens keeps source associated group and clears moved membership', () => {
  resetStore();
  addTab(makeTab('tab-1', 'running'));
  addTab(makeTab('tab-2', 'running'));
  const groupId = createGroup('Group 1', '#123456', ['tab-2'], ['cfg-1']);
  const targetScreenId = moveTabToNewScreen('tab-1');
  assert.ok(targetScreenId);

  const moved = moveTabToScreen('tab-2', targetScreenId!);
  assert.equal(moved, true);

  const source = getScreens().find(screen => screen.id === 'screen-a');
  const sourceGroup = source?.groups.find(group => group.id === groupId);
  assert.ok(sourceGroup);
  assert.deepEqual(sourceGroup?.tabIds, []);
  assert.deepEqual(sourceGroup?.associatedConfigIds, ['cfg-1']);
});

test('move tab across screens does not auto-attach into target associated group', () => {
  resetStore();
  addTab(makeTab('tab-1', 'running'));
  const targetScreenId = moveTabToNewScreen('tab-1');
  assert.ok(targetScreenId);

  setState({
    screens: getState().screens.map(screen => screen.id === targetScreenId
      ? {
        ...screen,
        groups: [{
          id: 'group-target',
          name: 'Config 1',
          color: '#123456',
          collapsed: false,
          tabIds: [],
          associatedConfigIds: ['cfg-1'],
        }],
      }
      : screen),
  });

  const movedBack = moveTabToScreen('tab-1', 'screen-a');
  assert.equal(movedBack, true);
  const movedAgain = moveTabToScreen('tab-1', targetScreenId!);
  assert.equal(movedAgain, true);

  const target = getScreens().find(screen => screen.id === targetScreenId);
  const group = target?.groups.find(item => item.id === 'group-target');
  assert.ok(group);
  assert.deepEqual(group?.tabIds, []);
});

test('move tab between two screens does not mutate unrelated third screen state', () => {
  resetStore();
  addTab(makeTab('tab-1', 'running'));
  addTab(makeTab('tab-2', 'running'));
  addTab(makeTab('tab-3', 'running'));

  const screenB = moveTabToNewScreen('tab-2');
  assert.ok(screenB);
  const screenC = moveTabToNewScreen('tab-3');
  assert.ok(screenC);

  // Seed unrelated screen (screen-c) with its own group state.
  const groupC = createGroup('Group C', '#00aa88', ['tab-3'], ['cfg-1']);
  assert.ok(groupC);

  const beforeC = getScreens().find(screen => screen.id === screenC);
  assert.ok(beforeC);

  const moved = moveTabToScreen('tab-1', screenB!);
  assert.equal(moved, true);

  const afterC = getScreens().find(screen => screen.id === screenC);
  assert.deepEqual(afterC, beforeC);
});

test('normalize keeps tab ownership unique across screens when duplicate tab ids drift in', () => {
  resetStore();
  const tab = makeTab('dup-tab', 'running');
  setState({
    screens: [
      { id: 'screen-a', name: 'Screen A', tabs: [tab], activeTabId: 'dup-tab', groups: [] },
      { id: 'screen-b', name: 'Screen B', tabs: [{ ...tab }], activeTabId: 'dup-tab', groups: [] },
    ],
    activeScreenId: 'screen-a',
  });

  const screens = getState().screens;
  const owners = screens.filter(screen => screen.tabs.some(item => item.id === 'dup-tab'));
  assert.equal(owners.length, 1);
  assert.equal(owners[0].id, 'screen-a');
});

test('remove tab only affects owning screen', () => {
  resetStore();
  addTab(makeTab('tab-1', 'running'));
  addTab(makeTab('tab-2', 'running'));
  const targetScreenId = moveTabToNewScreen('tab-2');
  assert.ok(targetScreenId);

  removeTab('tab-1');
  const screens = getScreens();
  const sourceTabs = screens.find(screen => screen.id === 'screen-a')?.tabs || [];
  const targetTabs = screens.find(screen => screen.id === targetScreenId)?.tabs || [];
  assert.equal(sourceTabs.length, 0);
  assert.equal(targetTabs.length, 1);
});

test('next waiting can pick tab from another screen', () => {
  resetStore();
  addTab(makeTab('tab-running', 'running'));
  addTab(makeTab('tab-waiting', 'running'));
  const targetScreenId = moveTabToNewScreen('tab-waiting');
  assert.ok(targetScreenId);

  setTabRuntimeState('tab-running', {
    state: 'running',
    confidence: 'high',
    reason: 'active',
    source: 'explicit',
    updatedAt: Date.now(),
  });
  setTabRuntimeState('tab-waiting', {
    state: 'waiting',
    confidence: 'high',
    reason: 'needs input',
    source: 'explicit',
    updatedAt: Date.now(),
  });

  const nextWaiting = findNextWaitingTabId('tab-running');
  assert.equal(nextWaiting, 'tab-waiting');
  const counts = getRuntimeStateCounts();
  assert.equal(counts.waiting, 1);
});

test('remove screen can clear workspace when deleting last remaining screen', () => {
  resetStore();
  addTab(makeTab('tab-1', 'running'));
  addTab(makeTab('tab-2', 'running'));
  const second = moveTabToNewScreen('tab-2');
  assert.ok(second);

  const removed = removeScreen(second!);
  assert.equal(removed, true);
  assert.equal(getScreens().length, 1);
  assert.equal(removeScreen('screen-a'), true);
  const screens = getScreens();
  assert.equal(screens.length, 1);
  assert.equal(screens[0].id, 'screen-a');
  assert.equal(screens[0].tabs.length, 0);
  assert.equal(screens[0].groups.length, 0);
});

test('new group attaches selected tab and supports inline rename flow primitives', () => {
  resetStore();
  addTab(makeTab('tab-1', 'running'));
  addTab(makeTab('tab-2', 'running'));
  const groupId = createGroup('Config 1', '#123456', ['tab-2'], ['cfg-1']);
  const screen = getScreens()[0];
  const group = screen.groups.find(item => item.id === groupId);
  assert.ok(group);
  assert.deepEqual(group?.tabIds, ['tab-2']);
});

test('addTab does not auto-attach tab into associated config group', () => {
  resetStore();
  createGroup('Config 1', '#123456', [], ['cfg-1']);

  addTab(makeTab('tab-1', 'running'));
  const screen = getScreens()[0];
  const group = screen.groups[0];
  assert.deepEqual(group?.tabIds, []);
});

test('reconcileTabsIntoAssociatedGroups hydrates saved associated groups for existing tabs', () => {
  resetStore();
  const tab = makeTab('tab-1', 'running');
  setState({
    screens: [{
      id: 'screen-a',
      name: 'Screen A',
      tabs: [tab],
      activeTabId: tab.id,
      groups: [{
        id: 'group-1',
        name: 'Config 1',
        color: '#123456',
        collapsed: false,
        tabIds: [],
        associatedConfigIds: ['cfg-1'],
      }],
    }],
    activeScreenId: 'screen-a',
  });

  reconcileTabsIntoAssociatedGroups('screen-a');
  const group = getScreens()[0].groups[0];
  assert.deepEqual(group?.tabIds, ['tab-1']);
});

test('move tab to group and remove from group update only active screen groups', () => {
  resetStore();
  addTab(makeTab('tab-1', 'running'));
  addTab(makeTab('tab-2', 'running'));
  const groupId = createGroup('Group A', '#123456', ['tab-1'], ['cfg-1']);

  moveTabToGroup('tab-2', groupId);
  let group = getScreens()[0].groups.find(item => item.id === groupId);
  assert.deepEqual(group?.tabIds, ['tab-1', 'tab-2']);

  removeTabFromGroup('tab-1');
  group = getScreens()[0].groups.find(item => item.id === groupId);
  assert.deepEqual(group?.tabIds, ['tab-2']);
});

test('toggle group collapse does not clear member tabs', () => {
  resetStore();
  addTab(makeTab('tab-1', 'running'));
  addTab(makeTab('tab-2', 'running'));
  const groupId = createGroup('Group A', '#123456', ['tab-1', 'tab-2'], ['cfg-1']);

  toggleGroupCollapse(groupId);
  let group = getScreens()[0].groups.find(item => item.id === groupId);
  assert.equal(group?.collapsed, true);
  assert.deepEqual(group?.tabIds, ['tab-1', 'tab-2']);

  toggleGroupCollapse(groupId);
  group = getScreens()[0].groups.find(item => item.id === groupId);
  assert.equal(group?.collapsed, false);
});
