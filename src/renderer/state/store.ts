import type {
  ModelConfig,
  RunnerMetricsSnapshot,
  RuntimeState,
  ScreenWorkspace,
  TerminalRuntimeState,
  TerminalTab,
  TabGroup,
} from '../../shared/types.js';

type Listener = () => void;

const MAX_SCREENS = 4;

function createDefaultScreen(id = 'screen-a', name = 'Screen A'): ScreenWorkspace {
  return {
    id,
    name,
    tabs: [],
    activeTabId: null,
    groups: [],
  };
}

function ensureScreenName(index: number): string {
  return `Screen ${String.fromCharCode('A'.charCodeAt(0) + index)}`;
}

function getScreenIdByIndex(index: number): string {
  return `screen-${String.fromCharCode('a'.charCodeAt(0) + index)}`;
}

function getFirstAvailableScreenSlot(screens: ScreenWorkspace[]): { index: number; id: string; name: string } | null {
  const usedIds = new Set(screens.map(screen => screen.id));
  for (let index = 0; index < MAX_SCREENS; index += 1) {
    const id = getScreenIdByIndex(index);
    if (usedIds.has(id)) continue;
    return { index, id, name: ensureScreenName(index) };
  }
  return null;
}

export interface AppState {
  configs: ModelConfig[];
  selectedConfigId: string | null;
  // Legacy compatibility fields: always mirror active screen.
  tabs: TerminalTab[];
  activeTabId: string | null;
  groups: TabGroup[];
  screens: ScreenWorkspace[];
  activeScreenId: string;
  sidebarVisible: boolean;
  sidebarWidth: number;
  searchQuery: string;
  fontSize: number;
  useWebglRenderer: boolean;
  worktreeRecentRepoPaths: string[];
  worktreeDefaultTargetRef: string;
  runtimeStatesByTabId: Record<string, TerminalRuntimeState>;
  protocolMetrics: RunnerMetricsSnapshot | null;
}

const initialScreens = [createDefaultScreen()];

const initialState: AppState = {
  configs: [],
  selectedConfigId: null,
  tabs: [],
  activeTabId: null,
  groups: [],
  screens: initialScreens,
  activeScreenId: initialScreens[0].id,
  sidebarVisible: true,
  sidebarWidth: 260,
  searchQuery: '',
  fontSize: 14,
  useWebglRenderer: false,
  worktreeRecentRepoPaths: [],
  worktreeDefaultTargetRef: 'main',
  runtimeStatesByTabId: {},
  protocolMetrics: null,
};

let state: AppState = { ...initialState };
const listeners = new Set<Listener>();

function cloneScreen(screen: ScreenWorkspace): ScreenWorkspace {
  return {
    ...screen,
    tabs: [...screen.tabs],
    groups: screen.groups.map(group => ({ ...group, tabIds: [...group.tabIds], associatedConfigIds: [...group.associatedConfigIds] })),
  };
}

function normalizeScreenCollection(next: AppState): AppState {
  let screens = next.screens && next.screens.length > 0
    ? next.screens.map(cloneScreen)
    : [createDefaultScreen()];

  const seenScreenIds = new Set<string>();
  screens = screens.filter(screen => {
    if (!screen.id || seenScreenIds.has(screen.id)) return false;
    seenScreenIds.add(screen.id);
    return true;
  });

  if (screens.length === 0) {
    screens = [createDefaultScreen()];
  }

  if (screens.length > MAX_SCREENS) {
    screens = screens.slice(0, MAX_SCREENS);
  }

  const seenTabIds = new Set<string>();
  screens = screens.map((screen, index) => {
    const uniqueTabs = screen.tabs.filter(tab => {
      if (seenTabIds.has(tab.id)) return false;
      seenTabIds.add(tab.id);
      return true;
    });
    const groups = screen.groups.map(group => ({
      ...group,
      tabIds: group.tabIds.filter(tabId => uniqueTabs.some(tab => tab.id === tabId)),
      associatedConfigIds: [...group.associatedConfigIds],
    }));
    const activeTabId = uniqueTabs.some(tab => tab.id === screen.activeTabId)
      ? screen.activeTabId
      : (uniqueTabs[0]?.id || null);
    return {
      ...screen,
      name: screen.name?.trim() ? screen.name : ensureScreenName(index),
      tabs: uniqueTabs,
      activeTabId,
      groups,
    };
  });

  let activeScreenId = next.activeScreenId;
  if (!screens.some(screen => screen.id === activeScreenId)) {
    activeScreenId = screens[0].id;
  }

  const activeScreen = screens.find(screen => screen.id === activeScreenId) || screens[0];
  return {
    ...next,
    screens,
    activeScreenId,
    tabs: [...activeScreen.tabs],
    activeTabId: activeScreen.activeTabId,
    groups: activeScreen.groups.map(group => ({ ...group, tabIds: [...group.tabIds], associatedConfigIds: [...group.associatedConfigIds] })),
  };
}

function applyActiveScreenLegacyPatch(next: AppState, partial: Partial<AppState>): AppState {
  const touchedLegacy =
    Object.prototype.hasOwnProperty.call(partial, 'tabs')
    || Object.prototype.hasOwnProperty.call(partial, 'activeTabId')
    || Object.prototype.hasOwnProperty.call(partial, 'groups');
  if (!touchedLegacy) {
    return next;
  }

  const screenIndex = next.screens.findIndex(screen => screen.id === next.activeScreenId);
  if (screenIndex < 0) return next;

  const current = next.screens[screenIndex];
  const tabs = Object.prototype.hasOwnProperty.call(partial, 'tabs') ? [...(partial.tabs || [])] : [...current.tabs];
  const activeTabId = Object.prototype.hasOwnProperty.call(partial, 'activeTabId')
    ? partial.activeTabId || null
    : current.activeTabId;
  const groups = Object.prototype.hasOwnProperty.call(partial, 'groups')
    ? (partial.groups || []).map(group => ({ ...group, tabIds: [...group.tabIds], associatedConfigIds: [...group.associatedConfigIds] }))
    : current.groups.map(group => ({ ...group, tabIds: [...group.tabIds], associatedConfigIds: [...group.associatedConfigIds] }));

  const screens = [...next.screens];
  screens[screenIndex] = {
    ...current,
    tabs,
    activeTabId,
    groups,
  };

  return {
    ...next,
    screens,
    tabs,
    activeTabId,
    groups,
  };
}

function setNormalizedState(next: AppState): void {
  state = normalizeScreenCollection(next);
  notify();
}

export function getState(): AppState {
  return state;
}

export function setState(partial: Partial<AppState>): void {
  let next = { ...state, ...partial } as AppState;
  next = normalizeScreenCollection(next);
  next = applyActiveScreenLegacyPatch(next, partial);
  setNormalizedState(next);
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

function findScreen(screenId: string): ScreenWorkspace | undefined {
  return state.screens.find(screen => screen.id === screenId);
}

function updateScreen(screenId: string, updater: (screen: ScreenWorkspace) => ScreenWorkspace): void {
  const screens = state.screens.map(screen => (screen.id === screenId ? updater(cloneScreen(screen)) : cloneScreen(screen)));
  setState({ screens });
}

function updateActiveScreen(updater: (screen: ScreenWorkspace) => ScreenWorkspace): void {
  updateScreen(state.activeScreenId, updater);
}

function getVisibleTabsFromScreen(screen: ScreenWorkspace): TerminalTab[] {
  const visible: TerminalTab[] = [];
  const grouped = new Set<string>();
  for (const group of screen.groups) {
    for (const tid of group.tabIds) grouped.add(tid);
    if (!group.collapsed) {
      for (const tid of group.tabIds) {
        const tab = screen.tabs.find(item => item.id === tid);
        if (tab) visible.push(tab);
      }
    }
  }
  for (const tab of screen.tabs) {
    if (!grouped.has(tab.id)) visible.push(tab);
  }
  return visible;
}

function getOrderedTabsIncludingCollapsedFromScreen(screen: ScreenWorkspace): TerminalTab[] {
  const ordered: TerminalTab[] = [];
  const grouped = new Set<string>();
  for (const group of screen.groups) {
    for (const tid of group.tabIds) {
      grouped.add(tid);
      const tab = screen.tabs.find(item => item.id === tid);
      if (tab) ordered.push(tab);
    }
  }
  for (const tab of screen.tabs) {
    if (!grouped.has(tab.id)) ordered.push(tab);
  }
  return ordered;
}

function removeTabFromGroups(groups: TabGroup[], tabId: string): TabGroup[] {
  return groups
    .map(group => ({
      ...group,
      tabIds: group.tabIds.filter(id => id !== tabId),
    }))
    .filter(group => group.tabIds.length > 0);
}

function removeTabFromGroupsForScreenMove(groups: TabGroup[], tabId: string): TabGroup[] {
  return groups
    .map(group => ({
      ...group,
      tabIds: group.tabIds.filter(id => id !== tabId),
      associatedConfigIds: [...group.associatedConfigIds],
    }))
    .filter(group => group.tabIds.length > 0 || group.associatedConfigIds.length > 0);
}

function reconcileTabsIntoAssociatedGroupsForScreen(screen: ScreenWorkspace): ScreenWorkspace {
  if (screen.groups.length === 0 || screen.tabs.length === 0) return screen;

  const tabIdsInScreen = new Set(screen.tabs.map(tab => tab.id));
  const assigned = new Set<string>();
  const groups = screen.groups.map(group => {
    const uniqueExistingTabIds = group.tabIds.filter(tabId => {
      if (!tabIdsInScreen.has(tabId)) return false;
      if (assigned.has(tabId)) return false;
      assigned.add(tabId);
      return true;
    });
    return {
      ...group,
      tabIds: uniqueExistingTabIds,
      associatedConfigIds: [...group.associatedConfigIds],
    };
  });

  for (const tab of screen.tabs) {
    if (assigned.has(tab.id)) continue;
    const targetGroup = groups.find(group => group.associatedConfigIds.includes(tab.configId));
    if (!targetGroup) continue;
    targetGroup.tabIds = [...targetGroup.tabIds, tab.id];
    assigned.add(tab.id);
  }

  return {
    ...screen,
    groups,
  };
}

export function getScreens(): ScreenWorkspace[] {
  return state.screens.map(cloneScreen);
}

export function getActiveScreen(): ScreenWorkspace {
  return cloneScreen(findScreen(state.activeScreenId) || state.screens[0]);
}

export function setActiveScreen(screenId: string): void {
  if (!findScreen(screenId)) return;
  setState({ activeScreenId: screenId });
}

export function ensureScreenForMove(): string | null {
  if (state.screens.length >= MAX_SCREENS) return null;
  const slot = getFirstAvailableScreenSlot(state.screens);
  if (!slot) return null;
  const screen = createDefaultScreen(slot.id, slot.name);
  setState({ screens: [...state.screens.map(cloneScreen), screen] });
  return slot.id;
}

export function removeScreen(screenId: string): boolean {
  if (!state.screens.some(screen => screen.id === screenId)) return false;
  if (state.screens.length <= 1) {
    setState({
      screens: [createDefaultScreen()],
      activeScreenId: 'screen-a',
      tabs: [],
      activeTabId: null,
      groups: [],
    });
    return true;
  }
  const screens = state.screens
    .filter(screen => screen.id !== screenId)
    .map(cloneScreen);
  if (screens.length === 0) return false;
  const nextActive = screens.find(screen => screen.tabs.length > 0)?.id || screens[0].id;
  setState({
    screens,
    activeScreenId: nextActive,
  });
  return true;
}

export function moveTabToScreen(tabId: string, targetScreenId: string): boolean {
  const target = findScreen(targetScreenId);
  if (!target) return false;

  let sourceScreenId: string | null = null;
  let movedTab: TerminalTab | null = null;

  const screens = state.screens.map(screen => {
    const next = cloneScreen(screen);
    const idx = next.tabs.findIndex(tab => tab.id === tabId);
    if (idx >= 0) {
      sourceScreenId = next.id;
      movedTab = next.tabs[idx];
      next.tabs.splice(idx, 1);
      next.groups = removeTabFromGroupsForScreenMove(next.groups, tabId);
      if (next.activeTabId === tabId) {
        const visible = getVisibleTabsFromScreen(next);
        next.activeTabId = visible.length > 0 ? visible[0].id : null;
      }
    }
    return next;
  });

  if (!sourceScreenId || !movedTab) return false;
  if (sourceScreenId === targetScreenId) return true;

  const targetIndex = screens.findIndex(screen => screen.id === targetScreenId);
  if (targetIndex < 0) return false;

  screens[targetIndex] = {
    ...screens[targetIndex],
    tabs: [...screens[targetIndex].tabs, movedTab],
    activeTabId: movedTab.id,
  };

  setState({ screens, activeScreenId: targetScreenId });
  return true;
}

export function moveTabToNewScreen(tabId: string): string | null {
  const screenId = ensureScreenForMove();
  if (!screenId) return null;
  if (!moveTabToScreen(tabId, screenId)) {
    return null;
  }
  return screenId;
}

export function getTabScreenId(tabId: string): string | null {
  const screen = state.screens.find(item => item.tabs.some(tab => tab.id === tabId));
  return screen ? screen.id : null;
}

export function getAllTabs(): TerminalTab[] {
  const tabs: TerminalTab[] = [];
  for (const screen of state.screens) {
    tabs.push(...screen.tabs);
  }
  return tabs;
}

// Helper actions
export function addTab(tab: TerminalTab): void {
  updateActiveScreen(screen => ({
    ...screen,
    tabs: [...screen.tabs, tab],
    activeTabId: tab.id,
  }));
}

export function removeTab(tabId: string): void {
  const screenId = getTabScreenId(tabId);
  if (!screenId) return;
  updateScreen(screenId, screen => {
    const tabs = screen.tabs.filter(tab => tab.id !== tabId);
    const groups = removeTabFromGroups(screen.groups, tabId);
    let activeTabId = screen.activeTabId;
    if (activeTabId === tabId) {
      const visible = getVisibleTabsFromScreen({ ...screen, tabs, groups });
      activeTabId = visible.length > 0 ? visible[0].id : null;
    }
    const runtimeStatesByTabId = { ...state.runtimeStatesByTabId };
    delete runtimeStatesByTabId[tabId];
    setState({ runtimeStatesByTabId });
    return {
      ...screen,
      tabs,
      groups,
      activeTabId,
    };
  });
}

export function updateTabStatus(tabId: string, status: TerminalTab['status']): void {
  const screens = state.screens.map(screen => ({
    ...cloneScreen(screen),
    tabs: screen.tabs.map(tab => (tab.id === tabId ? { ...tab, status } : tab)),
  }));
  setState({ screens });
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
  for (const tab of getAllTabs()) {
    counts[getTabEffectiveState(tab)] += 1;
  }
  return counts;
}

export function renameTab(tabId: string, customName: string | undefined): void {
  const screens = state.screens.map(screen => ({
    ...cloneScreen(screen),
    tabs: screen.tabs.map(tab => (tab.id === tabId ? { ...tab, customName } : tab)),
  }));
  setState({ screens });
}

export function setActiveTab(tabId: string): void {
  const screenId = getTabScreenId(tabId);
  if (!screenId) return;
  updateScreen(screenId, screen => ({
    ...screen,
    activeTabId: tabId,
  }));
  setState({ activeScreenId: screenId });
}

export function getVisibleTabs(): TerminalTab[] {
  return getVisibleTabsFromScreen(getActiveScreen());
}

export function findNextWaitingTabId(fromTabId?: string | null): string | null {
  const ordered: TerminalTab[] = [];
  for (const screen of state.screens) {
    ordered.push(...getOrderedTabsIncludingCollapsedFromScreen(screen));
  }
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
  const screenId = getTabScreenId(tabId);
  if (!screenId) return;
  updateScreen(screenId, screen => {
    const group = screen.groups.find(item => item.tabIds.includes(tabId));
    if (!group || !group.collapsed) return screen;
    return {
      ...screen,
      groups: screen.groups.map(item => (item.id === group.id ? { ...item, collapsed: false } : item)),
    };
  });
}

export function nextTab(): void {
  const screen = getActiveScreen();
  const visible = getVisibleTabsFromScreen(screen);
  if (visible.length <= 1) return;
  const currentIndex = visible.findIndex(tab => tab.id === screen.activeTabId);
  const nextIndex = (currentIndex + 1) % visible.length;
  setActiveTab(visible[nextIndex].id);
}

export function prevTab(): void {
  const screen = getActiveScreen();
  const visible = getVisibleTabsFromScreen(screen);
  if (visible.length <= 1) return;
  const currentIndex = visible.findIndex(tab => tab.id === screen.activeTabId);
  const prevIndex = (currentIndex - 1 + visible.length) % visible.length;
  setActiveTab(visible[prevIndex].id);
}

export function goToTab(index: number): void {
  const screen = getActiveScreen();
  const visible = getVisibleTabsFromScreen(screen);
  if (index >= 0 && index < visible.length) {
    setActiveTab(visible[index].id);
  }
}

// ---- Group management ----

let groupIdCounter = 0;

function generateGroupId(): string {
  return `group-${Date.now()}-${++groupIdCounter}`;
}

export function createGroup(name: string, color: string, initialTabIds?: string[], associatedConfigIds?: string[]): string {
  const id = generateGroupId();
  updateActiveScreen(screen => {
    const group: TabGroup = {
      id,
      name,
      color,
      collapsed: false,
      tabIds: initialTabIds || [],
      associatedConfigIds: associatedConfigIds || [],
    };
    let groups = [...screen.groups];
    if (initialTabIds && initialTabIds.length > 0) {
      const tabSet = new Set(initialTabIds);
      groups = groups.map(item => ({
        ...item,
        tabIds: item.tabIds.filter(tid => !tabSet.has(tid)),
      }));
    }
    groups.push(group);
    return { ...screen, groups };
  });
  return id;
}

export function deleteGroup(groupId: string): void {
  updateActiveScreen(screen => ({
    ...screen,
    groups: screen.groups.filter(group => group.id !== groupId),
  }));
}

export function renameGroup(groupId: string, name: string): void {
  updateActiveScreen(screen => ({
    ...screen,
    groups: screen.groups.map(group => (group.id === groupId ? { ...group, name } : group)),
  }));
}

export function toggleGroupCollapse(groupId: string): void {
  updateActiveScreen(screen => {
    const group = screen.groups.find(item => item.id === groupId);
    if (!group) return screen;
    const willCollapse = !group.collapsed;
    const groups = screen.groups.map(item => (item.id === groupId ? { ...item, collapsed: willCollapse } : item));
    let activeTabId = screen.activeTabId;
    if (willCollapse && activeTabId && group.tabIds.includes(activeTabId)) {
      const visible = getVisibleTabsFromScreen({ ...screen, groups });
      activeTabId = visible.length > 0 ? visible[0].id : null;
    }
    return {
      ...screen,
      groups,
      activeTabId,
    };
  });
}

export function moveTabToGroup(tabId: string, groupId: string): void {
  updateActiveScreen(screen => {
    const groups = screen.groups.map(group => {
      const filtered = group.tabIds.filter(id => id !== tabId);
      if (group.id === groupId) {
        return { ...group, tabIds: [...filtered, tabId] };
      }
      return { ...group, tabIds: filtered };
    }).filter(group => group.tabIds.length > 0);
    return {
      ...screen,
      groups,
    };
  });
}

export function moveTabRelative(draggedTabId: string, targetTabId: string, placeAfter: boolean): void {
  const screen = getActiveScreen();
  if (draggedTabId === targetTabId) return;
  if (!screen.tabs.some(tab => tab.id === draggedTabId)) return;
  if (!screen.tabs.some(tab => tab.id === targetTabId)) return;

  const sourceGroup = screen.groups.find(group => group.tabIds.includes(draggedTabId));
  const targetGroup = screen.groups.find(group => group.tabIds.includes(targetTabId));

  let groups = screen.groups.map(group => ({
    ...group,
    tabIds: group.tabIds.filter(id => id !== draggedTabId),
  }));

  if (targetGroup) {
    groups = groups.map(group => {
      if (group.id !== targetGroup.id) return group;
      const targetIndex = group.tabIds.indexOf(targetTabId);
      if (targetIndex === -1) return group;
      const insertAt = placeAfter ? targetIndex + 1 : targetIndex;
      const nextTabIds = [...group.tabIds];
      nextTabIds.splice(insertAt, 0, draggedTabId);
      return { ...group, tabIds: nextTabIds };
    });
    updateActiveScreen(item => ({ ...item, groups }));
    return;
  }

  const tabs = screen.tabs.filter(tab => tab.id !== draggedTabId);
  const targetIndex = tabs.findIndex(tab => tab.id === targetTabId);
  if (targetIndex !== -1) {
    const draggedTab = screen.tabs.find(tab => tab.id === draggedTabId);
    if (draggedTab) {
      const insertAt = placeAfter ? targetIndex + 1 : targetIndex;
      tabs.splice(insertAt, 0, draggedTab);
    }
  }

  updateActiveScreen(item => ({
    ...item,
    tabs,
    groups,
  }));
}

export function removeTabFromGroup(tabId: string): void {
  updateActiveScreen(screen => ({
    ...screen,
    groups: screen.groups
      .map(group => ({
        ...group,
        tabIds: group.tabIds.filter(id => id !== tabId),
      }))
      .filter(group => group.tabIds.length > 0),
  }));
}

export function getGroupTabIds(groupId: string): string[] {
  const group = getActiveScreen().groups.find(item => item.id === groupId);
  return group ? [...group.tabIds] : [];
}

export function autoGroupByConfig(): void {
  updateActiveScreen(screen => {
    const grouped = new Set<string>();
    for (const group of screen.groups) {
      for (const tid of group.tabIds) grouped.add(tid);
    }
    const ungrouped = screen.tabs.filter(tab => !grouped.has(tab.id));

    const buckets = new Map<string, TerminalTab[]>();
    for (const tab of ungrouped) {
      let list = buckets.get(tab.configId);
      if (!list) {
        list = [];
        buckets.set(tab.configId, list);
      }
      list.push(tab);
    }

    const groups = screen.groups.map(group => ({ ...group, tabIds: [...group.tabIds], associatedConfigIds: [...group.associatedConfigIds] }));
    for (const [configId, tabs] of buckets.entries()) {
      if (tabs.length < 2) continue;
      const existing = groups.find(group => group.associatedConfigIds.includes(configId));
      if (existing) {
        existing.tabIds = [...existing.tabIds, ...tabs.map(tab => tab.id)];
      } else {
        const sample = tabs[0];
        groups.push({
          id: generateGroupId(),
          name: sample.configName,
          color: sample.configColor,
          collapsed: false,
          tabIds: tabs.map(tab => tab.id),
          associatedConfigIds: [configId],
        });
      }
    }

    return {
      ...screen,
      groups,
    };
  });
}

export function getGroupForTab(tabId: string): TabGroup | undefined {
  return getActiveScreen().groups.find(group => group.tabIds.includes(tabId));
}

export function getUngroupedTabs(): TerminalTab[] {
  const screen = getActiveScreen();
  const grouped = new Set<string>();
  for (const group of screen.groups) {
    for (const tid of group.tabIds) grouped.add(tid);
  }
  return screen.tabs.filter(tab => !grouped.has(tab.id));
}

export function setScreenGroups(screenId: string, groups: TabGroup[]): void {
  updateScreen(screenId, screen => ({
    ...screen,
    groups: groups.map(group => ({ ...group, tabIds: [...group.tabIds], associatedConfigIds: [...group.associatedConfigIds] })),
  }));
}

export function reconcileTabsIntoAssociatedGroups(screenId: string): void {
  updateScreen(screenId, screen => reconcileTabsIntoAssociatedGroupsForScreen(screen));
}

export function setScreenLayout(layout: Array<{ id: string; name: string }>, activeScreenId?: string): void {
  const screens: ScreenWorkspace[] = layout.slice(0, MAX_SCREENS).map((item, index) => ({
    id: item.id,
    name: item.name || ensureScreenName(index),
    tabs: [],
    activeTabId: null,
    groups: [],
  }));
  setState({
    screens: screens.length > 0 ? screens : [createDefaultScreen()],
    activeScreenId: activeScreenId || (screens[0]?.id || 'screen-a'),
  });
}
