import type {
  ModelConfig,
  RunnerMetricsSnapshot,
  RuntimeState,
  TerminalRuntimeState,
  TerminalTab,
  TabGroup,
} from '../../shared/types.js';

type Listener = () => void;

export interface AppState {
  configs: ModelConfig[];
  selectedConfigId: string | null;
  tabs: TerminalTab[];
  activeTabId: string | null;
  sidebarVisible: boolean;
  sidebarWidth: number;
  searchQuery: string;
  fontSize: number;
  useWebglRenderer: boolean;
  restoreOnLaunch: boolean;
  restorePromptOnLaunch: boolean;
  worktreeRecentRepoPaths: string[];
  worktreeDefaultTargetRef: string;
  groups: TabGroup[];
  runtimeStatesByTabId: Record<string, TerminalRuntimeState>;
  protocolMetrics: RunnerMetricsSnapshot | null;
}

const initialState: AppState = {
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
};

let state: AppState = { ...initialState };
const listeners = new Set<Listener>();

export function getState(): AppState {
  return state;
}

export function setState(partial: Partial<AppState>): void {
  state = { ...state, ...partial };
  notify();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

// Helper actions
export function addTab(tab: TerminalTab): void {
  setState({
    tabs: [...state.tabs, tab],
    activeTabId: tab.id,
  });
}

export function removeTab(tabId: string): void {
  const tabs = state.tabs.filter(t => t.id !== tabId);
  // Remove from any group
  const groups = state.groups.map(g =>
    g.tabIds.includes(tabId) ? { ...g, tabIds: g.tabIds.filter(id => id !== tabId) } : g
  );
  let activeTabId = state.activeTabId;
  if (activeTabId === tabId) {
    // Prefer same-group neighbor, then visible list
    const group = state.groups.find(g => g.tabIds.includes(tabId));
    if (group) {
      const idx = group.tabIds.indexOf(tabId);
      const remaining = group.tabIds.filter(id => id !== tabId);
      if (remaining.length > 0) {
        activeTabId = remaining[Math.min(idx, remaining.length - 1)];
      } else {
        const visible = getVisibleTabsFromState({ ...state, tabs, groups });
        activeTabId = visible.length > 0 ? visible[0].id : null;
      }
    } else {
      const visible = getVisibleTabsFromState({ ...state, tabs, groups });
      if (visible.length > 0) {
        const oldVisibleIndex = getVisibleTabsFromState(state).findIndex(t => t.id === tabId);
        activeTabId = visible[Math.min(oldVisibleIndex, visible.length - 1)].id;
      } else {
        activeTabId = null;
      }
    }
  }
  const runtimeStatesByTabId = { ...state.runtimeStatesByTabId };
  delete runtimeStatesByTabId[tabId];
  setState({ tabs, groups, activeTabId, runtimeStatesByTabId });
}

export function updateTabStatus(tabId: string, status: TerminalTab['status']): void {
  setState({
    tabs: state.tabs.map(t => t.id === tabId ? { ...t, status } : t),
  });
}

export function setTabRuntimeState(tabId: string, runtimeState: TerminalRuntimeState): void {
  setState({
    runtimeStatesByTabId: {
      ...state.runtimeStatesByTabId,
      [tabId]: runtimeState,
    },
  });
}

export function setProtocolMetrics(metrics: RunnerMetricsSnapshot | null): void {
  setState({ protocolMetrics: metrics });
}

export function removeTabRuntimeState(tabId: string): void {
  if (!state.runtimeStatesByTabId[tabId]) return;
  const runtimeStatesByTabId = { ...state.runtimeStatesByTabId };
  delete runtimeStatesByTabId[tabId];
  setState({ runtimeStatesByTabId });
}

export function getTabRuntimeState(tabId: string): TerminalRuntimeState | undefined {
  return state.runtimeStatesByTabId[tabId];
}

export function getTabEffectiveState(tab: TerminalTab): RuntimeState {
  if (tab.status === 'exited') return 'exited';
  return state.runtimeStatesByTabId[tab.id]?.state || tab.status;
}

export function getRuntimeStateCounts(): Record<RuntimeState, number> {
  const counts: Record<RuntimeState, number> = {
    waiting: 0,
    running: 0,
    idle: 0,
    exited: 0,
  };
  for (const tab of state.tabs) {
    counts[getTabEffectiveState(tab)] += 1;
  }
  return counts;
}

export function renameTab(tabId: string, customName: string | undefined): void {
  setState({
    tabs: state.tabs.map(t => t.id === tabId ? { ...t, customName } : t),
  });
}

export function setActiveTab(tabId: string): void {
  setState({ activeTabId: tabId });
}

/** Get the ordered list of visible tabs (respecting group order and collapse state). */
function getVisibleTabsFromState(s: AppState): TerminalTab[] {
  const visible: TerminalTab[] = [];
  const grouped = new Set<string>();
  for (const group of s.groups) {
    for (const tid of group.tabIds) grouped.add(tid);
    if (!group.collapsed) {
      for (const tid of group.tabIds) {
        const tab = s.tabs.find(t => t.id === tid);
        if (tab) visible.push(tab);
      }
    }
  }
  // Ungrouped tabs
  for (const tab of s.tabs) {
    if (!grouped.has(tab.id)) visible.push(tab);
  }
  return visible;
}

export function getVisibleTabs(): TerminalTab[] {
  return getVisibleTabsFromState(state);
}

export function findNextWaitingTabId(fromTabId?: string | null): string | null {
  const ordered = getOrderedTabsIncludingCollapsed(state);
  if (ordered.length === 0) return null;
  const waitingTabs = ordered.filter(tab => getTabEffectiveState(tab) === 'waiting');
  if (waitingTabs.length === 0) return null;

  if (!fromTabId) return waitingTabs[0].id;
  const activeIndex = ordered.findIndex(tab => tab.id === fromTabId);
  if (activeIndex < 0) return waitingTabs[0].id;

  for (let offset = 1; offset <= ordered.length; offset++) {
    const idx = (activeIndex + offset) % ordered.length;
    if (getTabEffectiveState(ordered[idx]) === 'waiting') {
      return ordered[idx].id;
    }
  }
  return waitingTabs[0].id;
}

export function expandGroupForTab(tabId: string): void {
  const group = state.groups.find(g => g.tabIds.includes(tabId));
  if (!group || !group.collapsed) return;
  setState({
    groups: state.groups.map(g => (g.id === group.id ? { ...g, collapsed: false } : g)),
  });
}

export function nextTab(): void {
  const visible = getVisibleTabs();
  if (visible.length <= 1) return;
  const currentIndex = visible.findIndex(t => t.id === state.activeTabId);
  const nextIndex = (currentIndex + 1) % visible.length;
  setState({ activeTabId: visible[nextIndex].id });
}

export function prevTab(): void {
  const visible = getVisibleTabs();
  if (visible.length <= 1) return;
  const currentIndex = visible.findIndex(t => t.id === state.activeTabId);
  const prevIndex = (currentIndex - 1 + visible.length) % visible.length;
  setState({ activeTabId: visible[prevIndex].id });
}

export function goToTab(index: number): void {
  const visible = getVisibleTabs();
  if (index >= 0 && index < visible.length) {
    setState({ activeTabId: visible[index].id });
  }
}

// ---- Group management ----

let groupIdCounter = 0;

function generateGroupId(): string {
  return `group-${Date.now()}-${++groupIdCounter}`;
}

export function createGroup(name: string, color: string, initialTabIds?: string[], associatedConfigIds?: string[]): string {
  const id = generateGroupId();
  const group: TabGroup = {
    id,
    name,
    color,
    collapsed: false,
    tabIds: initialTabIds || [],
    associatedConfigIds: associatedConfigIds || [],
  };
  // Remove tabs from any existing groups
  let groups = [...state.groups];
  if (initialTabIds && initialTabIds.length > 0) {
    const tabSet = new Set(initialTabIds);
    groups = groups.map(g => ({
      ...g,
      tabIds: g.tabIds.filter(tid => !tabSet.has(tid)),
    }));
  }
  groups.push(group);
  setState({ groups });
  return id;
}

export function deleteGroup(groupId: string): void {
  setState({ groups: state.groups.filter(g => g.id !== groupId) });
}

export function renameGroup(groupId: string, name: string): void {
  setState({
    groups: state.groups.map(g => g.id === groupId ? { ...g, name } : g),
  });
}

export function toggleGroupCollapse(groupId: string): void {
  const group = state.groups.find(g => g.id === groupId);
  if (!group) return;
  const willCollapse = !group.collapsed;
  const newGroups = state.groups.map(g => g.id === groupId ? { ...g, collapsed: willCollapse } : g);
  let activeTabId = state.activeTabId;
  // If collapsing and active tab is in this group, switch to nearest visible tab
  if (willCollapse && activeTabId && group.tabIds.includes(activeTabId)) {
    const visible = getVisibleTabsFromState({ ...state, groups: newGroups });
    if (visible.length > 0) {
      activeTabId = visible[0].id;
    } else {
      activeTabId = null;
    }
  }
  setState({ groups: newGroups, activeTabId });
}

export function moveTabToGroup(tabId: string, groupId: string): void {
  // Remove from all groups first, then add to target
  const groups = state.groups.map(g => {
    const filtered = g.tabIds.filter(id => id !== tabId);
    if (g.id === groupId) {
      return { ...g, tabIds: [...filtered, tabId] };
    }
    return { ...g, tabIds: filtered };
  });
  setState({ groups });
}

export function moveTabRelative(draggedTabId: string, targetTabId: string, placeAfter: boolean): void {
  if (draggedTabId === targetTabId) return;
  if (!state.tabs.some(t => t.id === draggedTabId)) return;
  if (!state.tabs.some(t => t.id === targetTabId)) return;

  const sourceGroup = state.groups.find(g => g.tabIds.includes(draggedTabId));
  const targetGroup = state.groups.find(g => g.tabIds.includes(targetTabId));

  let groups = state.groups.map(g => ({
    ...g,
    tabIds: g.tabIds.filter(id => id !== draggedTabId),
  }));

  if (targetGroup) {
    groups = groups.map(g => {
      if (g.id !== targetGroup.id) return g;
      const targetIndex = g.tabIds.indexOf(targetTabId);
      if (targetIndex === -1) return g;
      const insertAt = placeAfter ? targetIndex + 1 : targetIndex;
      const nextTabIds = [...g.tabIds];
      nextTabIds.splice(insertAt, 0, draggedTabId);
      return { ...g, tabIds: nextTabIds };
    });
    setState({ groups });
    return;
  }

  // Target is ungrouped: update base tab order so ungrouped display order changes.
  const tabs = state.tabs.filter(t => t.id !== draggedTabId);
  const targetIndex = tabs.findIndex(t => t.id === targetTabId);
  if (targetIndex !== -1) {
    const draggedTab = state.tabs.find(t => t.id === draggedTabId);
    if (draggedTab) {
      const insertAt = placeAfter ? targetIndex + 1 : targetIndex;
      tabs.splice(insertAt, 0, draggedTab);
    }
  }

  // If dragged tab was grouped and target is ungrouped, it becomes ungrouped now.
  if (sourceGroup) {
    setState({ groups, tabs });
    return;
  }

  setState({ tabs, groups });
}

export function removeTabFromGroup(tabId: string): void {
  setState({
    groups: state.groups.map(g => ({
      ...g,
      tabIds: g.tabIds.filter(id => id !== tabId),
    })),
  });
}

export function getGroupTabIds(groupId: string): string[] {
  const group = state.groups.find(g => g.id === groupId);
  return group ? [...group.tabIds] : [];
}

export function autoGroupByConfig(): void {
  // Group ungrouped tabs by configId
  const grouped = new Set<string>();
  for (const g of state.groups) {
    for (const tid of g.tabIds) grouped.add(tid);
  }
  const ungrouped = state.tabs.filter(t => !grouped.has(t.id));

  // Bucket by configId
  const buckets = new Map<string, TerminalTab[]>();
  for (const tab of ungrouped) {
    let list = buckets.get(tab.configId);
    if (!list) {
      list = [];
      buckets.set(tab.configId, list);
    }
    list.push(tab);
  }

  let newGroups = [...state.groups];
  for (const [configId, tabs] of buckets) {
    if (tabs.length < 2) continue; // Only group if >=2 tabs
    // Check if an existing group already has this configId associated
    const existing = newGroups.find(g => g.associatedConfigIds.includes(configId));
    if (existing) {
      existing.tabIds = [...existing.tabIds, ...tabs.map(t => t.id)];
    } else {
      const sample = tabs[0];
      const id = generateGroupId();
      newGroups.push({
        id,
        name: sample.configName,
        color: sample.configColor,
        collapsed: false,
        tabIds: tabs.map(t => t.id),
        associatedConfigIds: [configId],
      });
    }
  }
  setState({ groups: newGroups });
}

export function getGroupForTab(tabId: string): TabGroup | undefined {
  return state.groups.find(g => g.tabIds.includes(tabId));
}

export function getUngroupedTabs(): TerminalTab[] {
  const grouped = new Set<string>();
  for (const g of state.groups) {
    for (const tid of g.tabIds) grouped.add(tid);
  }
  return state.tabs.filter(t => !grouped.has(t.id));
}

function getOrderedTabsIncludingCollapsed(s: AppState): TerminalTab[] {
  const ordered: TerminalTab[] = [];
  const grouped = new Set<string>();
  for (const group of s.groups) {
    for (const tid of group.tabIds) {
      grouped.add(tid);
      const tab = s.tabs.find(t => t.id === tid);
      if (tab) ordered.push(tab);
    }
  }
  for (const tab of s.tabs) {
    if (!grouped.has(tab.id)) ordered.push(tab);
  }
  return ordered;
}
