import {
  getState, setState, subscribe,
  addTab, removeTab, updateTabStatus, setActiveTab,
  nextTab, prevTab, goToTab,
  autoGroupByConfig,
  findNextWaitingTabId, setProtocolMetrics, setTabRuntimeState, removeTabRuntimeState, expandGroupForTab,
  getAllTabs, getScreens, getTabScreenId, setActiveScreen, setScreenGroups, setScreenLayout, removeScreen, reconcileTabsIntoAssociatedGroups,
} from './state/store.js';
import { createSidebar, type SidebarAction } from './components/Sidebar.js';
import { showConfigEditor, type ConfigEditorResult } from './components/ConfigEditor.js';
import {
  createScreenWorkspace,
  getVisibleTabIdsForScreens,
  isScreenWorkspaceInlineEditing,
} from './components/ScreenWorkspace.js';
import {
  createTerminalContainer, createTerminalView, writeToTerminal,
  destroyTerminal, fitAllTerminals, clearTerminal,
  selectAllInTerminal, copyFromTerminal, pasteToTerminal, setTerminalFontSize,
  getTerminalIdForTab, mountTerminalToHost, showTerminals, blurAllTerminals,
} from './components/TerminalView.js';
import { createWelcomeScreen } from './components/WelcomeScreen.js';
import { createStatusBar } from './components/StatusBar.js';
import { showPreferencesEditor } from './components/PreferencesEditor.js';
import { showPreflightDialog } from './components/PreflightDialog.js';
import { showScreenCloseDialog } from './components/ScreenCloseDialog.js';
import { showWorktreeLauncher } from './components/WorktreeLauncher.js';
import {
  showBatchStressLauncher,
  type BatchStressInput,
  type BatchStressProgress,
  type BatchStressRunHandle,
} from './components/BatchStressLauncher.js';
import { getCloseAllTabIds, getCloseOtherTabIds } from './tab-close-plan.js';
import { collectPreflightIssues, type PreflightCheckResult } from './preflight.js';
import type {
  ModelConfig,
  RuntimeState,
  RuntimeStateConfidence,
  RunnerEvent,
  TerminalRuntimeState,
  TerminalTab,
  TabGroupPersisted,
} from '../shared/types.js';

// Tab ID -> terminal ID mapping
const tabToTerminal = new Map<string, string>();
const terminalToTab = new Map<string, string>();
const tabToRunnerSession = new Map<string, string>();
const runnerSessionToTab = new Map<string, string>();
const runnerTransportByTab = new Map<string, string>();
const runnerLastEventByTab = new Map<string, string>();
let isRefreshingConfigs = false;
let metricsPollTimer: ReturnType<typeof setInterval> | null = null;
const terminalOutputBuffers = new Map<string, string>();
const spawnDedupLocks = new Map<string, number>();

async function init() {
  // Load settings
  const settings = await window.multiclaude.app.getSettings();
  const persistedScreens = settings.screens && settings.screens.length > 0
    ? settings.screens
    : [{ id: 'screen-a', name: 'Screen A' }];
  setScreenLayout(persistedScreens, settings.activeScreenId || persistedScreens[0]?.id);
  const persistedGroupsByScreen = settings.screenGroups || {};
  for (const screen of persistedScreens) {
    const persistedGroups: TabGroupPersisted[] = persistedGroupsByScreen[screen.id]
      || (screen.id === 'screen-a' ? (settings.groups || []) : []);
    setScreenGroups(screen.id, persistedGroups.map(group => ({
      ...group,
      collapsed: false,
      tabIds: [],
    })));
    reconcileTabsIntoAssociatedGroups(screen.id);
  }
  setState({ sidebarWidth: settings.sidebarWidth });
  setState({ useWebglRenderer: Boolean(settings.useWebglRenderer) });
  setState({
    worktreeRecentRepoPaths: settings.worktreeRecentRepoPaths || [],
    worktreeDefaultTargetRef: settings.worktreeDefaultTargetRef || 'main',
  });

  // Load configs
  const configs = await window.multiclaude.config.getAll();
  setState({
    configs,
    selectedConfigId: configs.length > 0 ? configs[0].id : null,
  });

  // Build layout
  const appEl = document.getElementById('app')!;
  appEl.innerHTML = '';

  const sidebar = createSidebar(handleSidebarAction);
  const mainArea = document.createElement('div');
  mainArea.className = 'main-area';

  const workspace = createScreenWorkspace({
    onTabClose: handleTabClose,
    onCloseOtherTabs: handleCloseOtherTabs,
    onCloseAllTabsInScreen: handleCloseAllTabsInScreen,
    onRemoveScreen: handleRemoveScreen,
    onLayoutChanged: persistScreenSettings,
  });
  const termContainer = createTerminalContainer();
  const welcomeScreen = createWelcomeScreen();
  const statusBar = createStatusBar(() => {
    jumpToNextWaiting();
  });

  mainArea.appendChild(workspace);
  mainArea.appendChild(termContainer);
  mainArea.appendChild(welcomeScreen);

  appEl.appendChild(sidebar);
  appEl.appendChild(mainArea);
  appEl.appendChild(statusBar);

  // Show/hide welcome screen and sidebar based on state
  subscribe(() => {
    const state = getState();
    const hasConfigs = state.configs.length > 0;
    const hasTabs = getAllTabs().length > 0;

    sidebar.classList.toggle('is-collapsed', !state.sidebarVisible);
    welcomeScreen.style.display = (!hasConfigs && !hasTabs) ? 'flex' : 'none';
    workspace.style.display = hasTabs ? 'grid' : 'none';
    // Terminal views are mounted into per-screen hosts; keep staging container hidden.
    termContainer.style.display = 'none';
    syncVisibleTerminals(workspace);
  });
  // Welcome screen create button
  document.getElementById('welcome-create-btn')?.addEventListener('click', () => {
    openConfigEditor(null);
  });

  // Listen for PTY data
  window.multiclaude.terminal.onData((terminalId, data) => {
    const tabId = terminalToTab.get(terminalId);
    if (tabId) {
      appendTerminalOutput(terminalId, data);
      writeToTerminal(tabId, data);
    }
  });

  // Listen for PTY exit
  window.multiclaude.terminal.onExit((terminalId, code) => {
    const tabId = terminalToTab.get(terminalId);
    if (tabId) {
      updateTabStatus(tabId, 'exited');
      // Notification if not active tab
      const state = getState();
      if (state.activeTabId !== tabId) {
        const tab = state.tabs.find(t => t.id === tabId);
        if (tab) {
          new Notification(tab.configName, {
            body: `Terminal process exited (code ${code})`,
          });
        }
      }
    }
  });

  window.multiclaude.terminal.onState((terminalId, runtimeState) => {
    const tabId = terminalToTab.get(terminalId);
    if (!tabId) return;
    setTabRuntimeState(tabId, runtimeState);
  });

  window.multiclaude.protocol.onEvent((event) => {
    onRunnerEvent(event);
  });

  // Listen for menu actions
  window.multiclaude.menu.onAction(handleMenuAction);

  // Listen for config changes from other windows/processes
  window.multiclaude.config.onChanged(() => {
    void refreshConfigs();
  });

  // Initial visibility
  const state = getState();
  sidebar.classList.toggle('is-collapsed', !state.sidebarVisible);
  welcomeScreen.style.display = state.configs.length === 0 ? 'flex' : 'none';
  workspace.style.display = 'none';
  termContainer.style.display = 'none';

  try {
    const snapshot = await window.multiclaude.terminal.getStateSnapshot();
    applyRuntimeSnapshot(snapshot);
  } catch (err) {
    console.warn('Failed to load terminal runtime snapshot:', err);
  }

  await refreshProtocolMetrics();
  if (!metricsPollTimer) {
    metricsPollTimer = setInterval(() => {
      void refreshProtocolMetrics();
    }, 2_000);
  }

}

function handleSidebarAction(action: SidebarAction) {
  switch (action.type) {
    case 'toggle-sidebar':
      toggleSidebar();
      break;
    case 'select-config':
      setState({ selectedConfigId: action.configId });
      break;
    case 'new-terminal':
      setState({ selectedConfigId: action.configId });
      spawnTerminal(action.configId);
      break;
    case 'system-terminal':
      setState({ selectedConfigId: action.configId });
      openSystemTerminal(action.configId);
      break;
    case 'worktree-terminal':
      setState({ selectedConfigId: action.configId });
      openWorktreeLauncher(action.configId);
      break;
    case 'batch-stress':
      setState({ selectedConfigId: action.configId });
      openBatchStressLauncher(action.configId);
      break;
    case 'edit-config': {
      const config = getState().configs.find(c => c.id === action.configId);
      if (config) openConfigEditor(config);
      break;
    }
    case 'duplicate-config':
      duplicateConfig(action.configId);
      break;
    case 'delete-config':
      deleteConfig(action.configId);
      break;
    case 'new-config':
      openConfigEditor(null);
      break;
  }
}

interface SpawnTerminalOptions {
  customName?: string;
  skipFocus?: boolean;
  interactivePreflight?: boolean;
  cwd?: string;
}

async function spawnTerminal(configId: string, options: SpawnTerminalOptions = {}): Promise<string | null> {
  const dedupeKey = `${configId}::${options.cwd || ''}::${options.customName || ''}`;
  const now = Date.now();
  const lastSpawnAt = spawnDedupLocks.get(dedupeKey) || 0;
  if (now - lastSpawnAt < 250) {
    return null;
  }
  spawnDedupLocks.set(dedupeKey, now);

  const config = getState().configs.find(c => c.id === configId);
  if (!config) return null;
  const shouldContinue = await runPreflightCheck(config, {
    interactive: options.interactivePreflight !== false,
  });
  if (!shouldContinue) {
    return null;
  }

  try {
    const { terminalId } = await window.multiclaude.terminal.spawn(configId, { cwd: options.cwd });
    const tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    tabToTerminal.set(tabId, terminalId);
    terminalToTab.set(terminalId, tabId);

    const tab: TerminalTab = {
      id: tabId,
      configId: config.id,
      configName: config.name,
      configColor: config.color,
      provider: config.provider,
      status: 'running',
      customName: options.customName,
    };

    addTab(tab);

    // Create terminal view
    const termContainer = document.querySelector('.terminal-container')!;
    createTerminalView(termContainer as HTMLElement, tabId, terminalId, config.color);
    if (!options.skipFocus) {
      setActiveTab(tabId);
    }
    persistScreenSettings();
    syncVisibleTerminals();
    void startRunnerSessionForTab(tabId, config.id, terminalId);

    void window.multiclaude.terminal.getStateSnapshot()
      .then((snapshot) => {
        const runtimeState = snapshot[terminalId];
        if (runtimeState) {
          setTabRuntimeState(tabId, runtimeState);
        }
      })
      .catch((err) => {
        console.warn('Failed to refresh terminal runtime snapshot:', err);
      });
    return tabId;
  } catch (err) {
    console.error('Failed to spawn terminal:', err);
    alert(`Failed to open terminal: ${formatError(err)}`);
    return null;
  } finally {
    const latest = spawnDedupLocks.get(dedupeKey);
    if (latest && latest === now) {
      // Keep a short dedupe window for accidental double/duplicate dispatch.
      setTimeout(() => {
        if (spawnDedupLocks.get(dedupeKey) === now) {
          spawnDedupLocks.delete(dedupeKey);
        }
      }, 350);
    }
  }
}

function handleTabClose(tabId: string, options: { persist?: boolean; sync?: boolean } = {}) {
  const persist = options.persist !== false;
  const sync = options.sync !== false;
  void endRunnerSessionForTab(tabId);
  const terminalId = tabToTerminal.get(tabId);
  if (terminalId) {
    window.multiclaude.terminal.kill(terminalId);
    terminalToTab.delete(terminalId);
    tabToTerminal.delete(tabId);
    terminalOutputBuffers.delete(terminalId);
  }
  removeTabRuntimeState(tabId);
  runnerLastEventByTab.delete(tabId);
  runnerTransportByTab.delete(tabId);
  destroyTerminal(tabId);
  removeTab(tabId);
  if (persist) persistScreenSettings();
  if (sync) syncVisibleTerminals();
}

async function startRunnerSessionForTab(tabId: string, configId: string, terminalId: string): Promise<void> {
  try {
    const result = await window.multiclaude.protocol.startSession(configId, terminalId);
    tabToRunnerSession.set(tabId, result.sessionId);
    runnerSessionToTab.set(result.sessionId, tabId);
    runnerTransportByTab.set(tabId, result.transportType || 'pty');
  } catch (err) {
    console.warn('Failed to start protocol session:', err);
  }
}

async function endRunnerSessionForTab(tabId: string): Promise<void> {
  const sessionId = tabToRunnerSession.get(tabId);
  if (!sessionId) return;
  tabToRunnerSession.delete(tabId);
  runnerSessionToTab.delete(sessionId);
  runnerTransportByTab.delete(tabId);
  try {
    await window.multiclaude.protocol.endSession(sessionId);
  } catch (err) {
    console.warn('Failed to end protocol session:', err);
  }
}

function onRunnerEvent(event: RunnerEvent): void {
  const tabId = runnerSessionToTab.get(event.sessionId);
  if (!tabId) return;

  applyRuntimeHintFromRunnerEvent(tabId, event);
  runnerLastEventByTab.set(tabId, event.type);
  if (event.type === 'status.changed') {
    if (event.to === 'fallback_pty') {
      const tab = getAllTabs().find(t => t.id === tabId);
      if (tab) {
        new Notification(tab.configName, {
          body: 'Protocol runner failed and automatically switched back to PTY.',
        });
      }
    }
  }
  void refreshProtocolMetrics();
}

function applyRuntimeHintFromRunnerEvent(tabId: string, event: RunnerEvent): void {
  const updatedAt = Number.isFinite(event.ts) ? event.ts : Date.now();
  if (event.type === 'input.requested') {
    setTabRuntimeState(tabId, buildRuntimeState('waiting', 'protocol input requested', updatedAt, 'high'));
    return;
  }
  if (event.type === 'status.changed') {
    if (event.to === 'awaiting_input') {
      setTabRuntimeState(tabId, buildRuntimeState('waiting', 'protocol awaiting input', updatedAt, 'high'));
      return;
    }
    if (event.to === 'streaming' || event.to === 'fallback_pty') {
      setTabRuntimeState(tabId, buildRuntimeState('running', `protocol status changed: ${event.to}`, updatedAt, 'high'));
      return;
    }
    if (event.to === 'idle' || event.to === 'completed') {
      setTabRuntimeState(tabId, buildRuntimeState('idle', `protocol status changed: ${event.to}`, updatedAt, 'high'));
      return;
    }
  }
  if (event.type === 'session.completed') {
    setTabRuntimeState(tabId, buildRuntimeState('idle', 'protocol session completed', updatedAt, 'high'));
    return;
  }
  if (event.type === 'session.failed') {
    setTabRuntimeState(tabId, buildRuntimeState('running', 'protocol session failed', updatedAt, 'medium'));
  }
}

function buildRuntimeState(
  state: RuntimeState,
  reason: string,
  updatedAt: number,
  confidence: RuntimeStateConfidence,
): TerminalRuntimeState {
  return {
    state,
    confidence,
    reason,
    source: 'explicit',
    updatedAt,
  };
}

async function refreshProtocolMetrics(): Promise<void> {
  try {
    const metrics = await window.multiclaude.protocol.getMetrics();
    setProtocolMetrics(metrics);
  } catch (err) {
    console.warn('Failed to get protocol metrics:', err);
  }
}

function openConfigEditor(existing: ModelConfig | null) {
  showConfigEditor(
    existing,
    async (result) => {
      try {
        if ('id' in result && result.id) {
          await window.multiclaude.config.update(result as any);
        } else {
          await window.multiclaude.config.create(result as any);
        }
        await refreshConfigs();
      } catch (err) {
        console.error('Failed to save config:', err);
        alert(`Failed to save config: ${formatError(err)}`);
      }
    },
    () => { /* cancel */ },
  );
}

async function duplicateConfig(id: string) {
  try {
    await window.multiclaude.config.duplicate(id);
    await refreshConfigs();
  } catch (err) {
    console.error('Failed to duplicate config:', err);
    alert(`Failed to duplicate config: ${formatError(err)}`);
  }
}

async function deleteConfig(id: string) {
  const config = getState().configs.find(c => c.id === id);
  if (!config) return;
  if (hasRunningTabsForConfig(id)) {
    alert('This config has running terminals. Please close them before deleting.');
    return;
  }

  if (!confirm(`Delete config "${config.name}"?`)) return;

  try {
    await window.multiclaude.config.delete(id);
    await refreshConfigs();

    // If deleted config was selected, select another
    const state = getState();
    if (state.selectedConfigId === id) {
      setState({
        selectedConfigId: state.configs.length > 0 ? state.configs[0].id : null,
      });
    }
  } catch (err) {
    console.error('Failed to delete config:', err);
    alert(`Failed to delete config: ${formatError(err)}`);
  }
}

async function refreshConfigs() {
  if (isRefreshingConfigs) return;
  isRefreshingConfigs = true;
  try {
    const configs = await window.multiclaude.config.getAll();
    const state = getState();
    const configIds = new Set(configs.map(c => c.id));
    // Clean up associatedConfigIds that no longer exist
    const screens = state.screens.map(screen => ({
      ...screen,
      groups: screen.groups.map(group => ({
        ...group,
        associatedConfigIds: group.associatedConfigIds.filter(cid => configIds.has(cid)),
      })),
    }));
    setState({
      configs,
      screens,
      selectedConfigId: state.selectedConfigId && configs.find(c => c.id === state.selectedConfigId)
        ? state.selectedConfigId
        : configs.length > 0 ? configs[0].id : null,
    });
    persistScreenSettings();
  } finally {
    isRefreshingConfigs = false;
  }
}

async function handleMenuAction(action: string, payload?: any) {
  const state = getState();

  switch (action) {
    case 'new-terminal':
      if (state.selectedConfigId) {
        spawnTerminal(state.selectedConfigId);
      }
      break;
    case 'new-system-terminal':
      if (state.selectedConfigId) {
        openSystemTerminal(state.selectedConfigId);
      }
      break;
    case 'new-worktree-terminal':
      if (state.selectedConfigId) {
        openWorktreeLauncher(state.selectedConfigId);
      }
      break;
    case 'close-terminal':
      if (state.activeTabId) {
        handleTabClose(state.activeTabId);
      }
      break;
    case 'new-config':
      openConfigEditor(null);
      break;
    case 'edit-config':
      if (state.selectedConfigId) {
        const config = state.configs.find(c => c.id === state.selectedConfigId);
        if (config) openConfigEditor(config);
      }
      break;
    case 'duplicate-config':
      if (state.selectedConfigId) {
        duplicateConfig(state.selectedConfigId);
      }
      break;
    case 'delete-config':
      if (state.selectedConfigId) {
        deleteConfig(state.selectedConfigId);
      }
      break;
    case 'import-configs': {
      try {
        const result = await window.multiclaude.config.import();
        if (result && result.imported > 0) {
          await refreshConfigs();
        }
        if (result && result.errors.length > 0) {
          alert(`Import completed with warnings:\n${result.errors.join('\n')}`);
        }
      } catch (err) {
        alert(`Failed to import configs: ${formatError(err)}`);
      }
      break;
    }
    case 'export-configs':
      try {
        await window.multiclaude.config.export();
      } catch (err) {
        alert(`Failed to export configs: ${formatError(err)}`);
      }
      break;
    case 'next-tab':
      nextTab();
      syncVisibleTerminals();
      break;
    case 'prev-tab':
      prevTab();
      syncVisibleTerminals();
      break;
    case 'go-to-tab':
      goToTab(payload as number);
      syncVisibleTerminals();
      break;
    case 'next-waiting':
      jumpToNextWaiting();
      break;
    case 'clear-terminal':
      if (payload) {
        // From context menu with specific terminal
        const tabId = findTabByTerminalId(payload);
        if (tabId) clearTerminal(tabId);
      } else if (state.activeTabId) {
        clearTerminal(state.activeTabId);
      }
      break;
    case 'select-all':
      if (payload) {
        const tabId = findTabByTerminalId(payload);
        if (tabId) selectAllInTerminal(tabId);
      } else if (state.activeTabId) {
        selectAllInTerminal(state.activeTabId);
      }
      break;
    case 'copy':
      if (state.activeTabId) copyFromTerminal(state.activeTabId);
      break;
    case 'paste':
      if (state.activeTabId) pasteToTerminal(state.activeTabId);
      break;
    case 'toggle-sidebar':
      toggleSidebar();
      break;
    case 'zoom-in': {
      const newSize = Math.min(state.fontSize + 2, 32);
      setState({ fontSize: newSize });
      setTerminalFontSize(newSize);
      break;
    }
    case 'zoom-out': {
      const newSize = Math.max(state.fontSize - 2, 8);
      setState({ fontSize: newSize });
      setTerminalFontSize(newSize);
      break;
    }
    case 'zoom-reset':
      setState({ fontSize: 14 });
      setTerminalFontSize(14);
      break;
    case 'open-system-terminal': {
      // From context menu - find config for this terminal
      if (payload) {
        const tabId = findTabByTerminalId(payload);
        if (tabId) {
          const tab = getAllTabs().find(t => t.id === tabId);
          if (tab) {
            openSystemTerminal(tab.configId);
          }
        }
      }
      break;
    }
    case 'preferences':
      openPreferences();
      break;
    case 'auto-group-by-config':
      autoGroupByConfig();
      persistScreenSettings();
      break;
  }
}

function toggleSidebar(): void {
  const state = getState();
  setState({ sidebarVisible: !state.sidebarVisible });
  requestAnimationFrame(fitAllTerminals);
}

function handleCloseOtherTabs(currentTabId: string) {
  const tabIdsToClose = getCloseOtherTabIds(
    getState().tabs.map(tab => tab.id),
    currentTabId,
  );
  for (const tabId of tabIdsToClose) {
    handleTabClose(tabId);
  }
  const tabs = getState().tabs;
  if (tabs.some(tab => tab.id === currentTabId)) {
    setActiveTab(currentTabId);
  }
  syncVisibleTerminals();
}

function handleCloseAllTabsInScreen(screenId: string) {
  const screen = getScreens().find(item => item.id === screenId);
  if (!screen) return;
  const tabIds = getCloseAllTabIds(screen.tabs.map(tab => tab.id));
  for (const tabId of tabIds) {
    handleTabClose(tabId);
  }
  syncVisibleTerminals();
}

async function handleRemoveScreen(screenId: string) {
  const screen = getScreens().find(item => item.id === screenId);
  if (!screen) return;
  const action = await showScreenCloseDialog({
    screenId: screen.id,
    screenName: screen.name,
    tabCount: screen.tabs.length,
  });
  if (action === 'cancel') return;

  if (action === 'close') {
    const preservedGroups: TabGroupPersisted[] = screen.groups.map(group => ({
      id: group.id,
      name: group.name,
      color: group.color,
      associatedConfigIds: group.associatedConfigIds,
    }));
    for (const tab of [...screen.tabs]) {
      handleTabClose(tab.id, { persist: false, sync: false });
    }
    setScreenGroups(screen.id, preservedGroups.map(group => ({
      ...group,
      collapsed: false,
      tabIds: [],
    })));
    const screens = getScreens();
    const fallbackScreenId = screens.find(item => item.id !== screen.id && item.tabs.length > 0)?.id
      || screens.find(item => item.id !== screen.id)?.id
      || null;
    if (fallbackScreenId) {
      setActiveScreen(fallbackScreenId);
    }
    syncVisibleTerminals();
    return;
  }

  for (const tab of [...screen.tabs]) {
    handleTabClose(tab.id, { persist: false, sync: false });
  }

  if (!removeScreen(screenId)) return;
  if (action === 'clear') {
    persistScreenSettings();
  }
  syncVisibleTerminals();
}

function persistScreenSettings() {
  const state = getState();
  const screens = state.screens.map(screen => ({ id: screen.id, name: screen.name }));
  const screenGroups: Record<string, TabGroupPersisted[]> = {};
  for (const screen of state.screens) {
    screenGroups[screen.id] = screen.groups.map(group => ({
      id: group.id,
      name: group.name,
      color: group.color,
      associatedConfigIds: group.associatedConfigIds,
    }));
  }
  void window.multiclaude.app.saveSettings({
    screens,
    activeScreenId: state.activeScreenId,
    screenGroups,
    groups: screenGroups['screen-a'] || [],
  });
}

function openPreferences() {
  const state = getState();
  showPreferencesEditor(
    {
      sidebarWidth: state.sidebarWidth,
      groups: state.groups,
      useWebglRenderer: state.useWebglRenderer,
    },
    async (result) => {
      setState({
        useWebglRenderer: result.useWebglRenderer,
      });
      await window.multiclaude.app.saveSettings({
        useWebglRenderer: result.useWebglRenderer,
      });
    },
    () => {},
  );
}

function openWorktreeLauncher(configId: string): void {
  const config = getState().configs.find(item => item.id === configId);
  if (!config) return;
  const state = getState();
  showWorktreeLauncher({
    config,
    initialRepoPath: state.worktreeRecentRepoPaths[0] || '',
    initialTargetRef: state.worktreeDefaultTargetRef || 'main',
    onOpenTerminal: (cwd) => {
      void spawnTerminal(configId, { cwd });
    },
    onPersistDefaults: async (repoPath, targetRef) => {
      const recent = [
        repoPath,
        ...getState().worktreeRecentRepoPaths.filter(item => item !== repoPath),
      ].slice(0, 5);
      setState({
        worktreeRecentRepoPaths: recent,
        worktreeDefaultTargetRef: targetRef || 'main',
      });
      await window.multiclaude.app.saveSettings({
        worktreeRecentRepoPaths: recent,
        worktreeDefaultTargetRef: targetRef || 'main',
      });
    },
  });
}

interface BatchStressRound {
  id?: string;
  prompt: string;
  waitForRegex?: string;
  forbidRegex?: string;
  timeoutSec?: number;
}

interface BatchStressInstance {
  index: number;
  dir: string;
  tabId: string;
  terminalId: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  failures: string[];
  marker: string;
  roundsCompleted: number;
}

interface BatchStressReport {
  jobName: string;
  configId: string;
  configName: string;
  rootDir: string;
  count: number;
  concurrency: number;
  startedAt: number;
  endedAt?: number;
  pausedTotalMs: number;
  instances: Array<{
    index: number;
    dir: string;
    status: BatchStressInstance['status'];
    roundsCompleted: number;
    failures: string[];
    marker: string;
  }>;
}

function openBatchStressLauncher(configId: string): void {
  const config = getState().configs.find(item => item.id === configId);
  if (!config) return;
  const state = getState();
  showBatchStressLauncher({
    config,
    initialRootDir: state.worktreeRecentRepoPaths[0] || '',
    onBrowseRoot: async (defaultPath) => {
      return await window.multiclaude.app.selectDirectory(defaultPath);
    },
    onDryRun: (input) => {
      const rounds = parseBatchStressRounds(input.roundsJson);
      const lines: string[] = [];
      lines.push(`# Config: ${config.name}`);
      lines.push(`# Job: ${input.jobName}`);
      lines.push(`# Root: ${input.rootDir}`);
      lines.push(`# Count: ${input.count}, Concurrency: ${input.concurrency}`);
      for (let i = 1; i <= input.count; i++) {
        const dir = joinPath(input.rootDir, renderStressTemplate(input.subdirPattern, {
          index: String(i),
          configName: config.name,
          dir: '',
          round: '1',
        }));
        lines.push(`mkdir -p ${dir}`);
        lines.push(`spawn terminal --cwd ${dir}`);
        lines.push(input.bootstrapCommand);
        if (input.enableIsolationCheck) {
          lines.push(`[isolation] MARK:${input.jobName}-i${i}`);
        }
        for (let r = 0; r < rounds.length; r++) {
          lines.push(`[round ${r + 1}] ${renderStressTemplate(rounds[r].prompt, {
            index: String(i),
            configName: config.name,
            dir,
            round: String(r + 1),
          })}`);
        }
      }
      return lines;
    },
    onRun: (input, hooks) => runBatchStress(config, input, hooks),
  });
}

function runBatchStress(
  config: ModelConfig,
  input: BatchStressInput,
  hooks: { log: (line: string) => void; progress: (stats: BatchStressProgress) => void },
): BatchStressRunHandle {
  let paused = false;
  let pauseStartedAt: number | null = null;
  let pausedTotalMs = 0;
  let lastReport: BatchStressReport | null = null;
  const reportPath = joinPath(input.rootDir, `${input.jobName}.report.json`);

  const controls = {
    pause: () => {
      if (paused) return;
      paused = true;
      pauseStartedAt = Date.now();
      hooks.log('[control] paused');
    },
    resume: () => {
      if (!paused) return;
      paused = false;
      if (pauseStartedAt) {
        pausedTotalMs += Date.now() - pauseStartedAt;
      }
      pauseStartedAt = null;
      hooks.log('[control] resumed');
    },
    isPaused: () => paused,
    exportReport: async (): Promise<string> => {
      if (!lastReport) {
        throw new Error('Report is not ready yet');
      }
      const payload = JSON.stringify(lastReport, null, 2);
      return await window.multiclaude.app.writeTextFile(reportPath, `${payload}\n`);
    },
  };

  const done = (async () => {
  const rounds = parseBatchStressRounds(input.roundsJson);
  const instances: BatchStressInstance[] = [];

  hooks.log(`Batch stress start: job=${input.jobName}, config=${config.name}, count=${input.count}, concurrency=${input.concurrency}`);
  const startedAt = Date.now();
  for (let i = 1; i <= input.count; i++) {
    const subdir = renderStressTemplate(input.subdirPattern, {
      index: String(i),
      configName: config.name,
      dir: '',
      round: '1',
    });
    const dir = joinPath(input.rootDir, subdir);
    await window.multiclaude.app.ensureDirectory(dir);
    const tabId = await spawnTerminal(config.id, {
      cwd: dir,
      skipFocus: true,
      customName: `stress-${i}`,
    });
    if (!tabId) {
      hooks.log(`[${i}] spawn failed`);
      continue;
    }
    const terminalId = tabToTerminal.get(tabId);
    if (!terminalId) {
      hooks.log(`[${i}] terminal mapping missing`);
      continue;
    }
    terminalOutputBuffers.set(terminalId, '');
    const marker = `${input.jobName}-i${i}`;
    instances.push({
      index: i,
      dir,
      tabId,
      terminalId,
      status: 'pending',
      failures: [],
      marker,
      roundsCompleted: 0,
    });
    hooks.log(`[${i}] ready dir=${dir}`);
  }

  const allMarkers = instances.map(item => item.marker);
  const workerCount = Math.max(1, Math.min(input.concurrency, instances.length));
  let cursor = 0;
  emitStressProgress(instances, hooks.progress);
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < instances.length) {
      await waitIfPaused(() => paused);
      const instance = instances[cursor++];
      instance.status = 'running';
      emitStressProgress(instances, hooks.progress);
      try {
        hooks.log(`[${instance.index}] bootstrap: ${input.bootstrapCommand}`);
        window.multiclaude.terminal.write(instance.terminalId, `${input.bootstrapCommand}\r`);
        await sleep(input.sendDelayMs + 700);
        if (input.enableIsolationCheck) {
          const initPrompt = `Stress isolation marker: ${instance.marker}. Reply READY MARK:${instance.marker}. In every following reply include MARK:${instance.marker}.`;
          const checkpoint = terminalOutputBuffers.get(instance.terminalId)?.length || 0;
          window.multiclaude.terminal.write(instance.terminalId, `${initPrompt}\r`);
          const readyOk = await waitForOutputRegex(instance.terminalId, `MARK:${instance.marker}`, 90_000, checkpoint, () => paused, allMarkers, instance.marker);
          if (!readyOk.ok) {
            throw new Error(`isolation init failed: ${readyOk.reason}`);
          }
        }
        for (let roundIndex = 0; roundIndex < rounds.length; roundIndex++) {
          await waitIfPaused(() => paused);
          const round = rounds[roundIndex];
          const context = {
            index: String(instance.index),
            configName: config.name,
            dir: instance.dir,
            round: String(roundIndex + 1),
          };
          let prompt = renderStressTemplate(round.prompt, context);
          if (input.enableIsolationCheck) {
            prompt = `${prompt}\n\n[must include token] MARK:${instance.marker}`;
          }
          hooks.log(`[${instance.index}] round ${roundIndex + 1}/${rounds.length} send`);
          const checkpoint = terminalOutputBuffers.get(instance.terminalId)?.length || 0;
          window.multiclaude.terminal.write(instance.terminalId, `${prompt}\r`);
          await sleep(input.sendDelayMs);

          const timeoutMs = Math.max(1, round.timeoutSec || 90) * 1000;
          if (round.waitForRegex?.trim()) {
            const expected = renderStressTemplate(round.waitForRegex, context);
            const ok = await waitForOutputRegex(
              instance.terminalId,
              expected,
              timeoutMs,
              checkpoint,
              () => paused,
              allMarkers,
              input.enableIsolationCheck ? instance.marker : undefined,
            );
            if (!ok.ok) {
              throw new Error(`round ${roundIndex + 1} wait failed: ${ok.reason}`);
            }
          } else {
            await waitForOutputRegex(
              instance.terminalId,
              '.+',
              Math.min(timeoutMs, 1200),
              checkpoint,
              () => paused,
              allMarkers,
              input.enableIsolationCheck ? instance.marker : undefined,
            );
          }
          if (round.forbidRegex?.trim()) {
            const forbidden = renderStressTemplate(round.forbidRegex, context);
            const segment = (terminalOutputBuffers.get(instance.terminalId) || '').slice(checkpoint);
            const forbiddenRe = toRegex(forbidden);
            if (forbiddenRe.test(segment)) {
              throw new Error(`round ${roundIndex + 1} forbidden pattern matched`);
            }
          }
          if (input.enableIsolationCheck) {
            const segment = (terminalOutputBuffers.get(instance.terminalId) || '').slice(checkpoint);
            const foreign = detectForeignMarker(segment, allMarkers, instance.marker);
            if (foreign) {
              throw new Error(`pollution detected: foreign marker ${foreign}`);
            }
            if (!new RegExp(`MARK:${escapeRegex(instance.marker)}`, 'm').test(segment)) {
              throw new Error(`round ${roundIndex + 1} own marker missing`);
            }
          }
          instance.roundsCompleted = roundIndex + 1;
        }
        instance.status = 'succeeded';
        hooks.log(`[${instance.index}] success`);
      } catch (err) {
        instance.status = 'failed';
        const reason = formatError(err);
        instance.failures.push(reason);
        hooks.log(`[${instance.index}] failed: ${reason}`);
      } finally {
        emitStressProgress(instances, hooks.progress);
      }
    }
  });
  await Promise.all(workers);
  if (pauseStartedAt) pausedTotalMs += Date.now() - pauseStartedAt;
  lastReport = {
    jobName: input.jobName,
    configId: config.id,
    configName: config.name,
    rootDir: input.rootDir,
    count: input.count,
    concurrency: input.concurrency,
    startedAt,
    endedAt: Date.now(),
    pausedTotalMs,
    instances: instances.map(item => ({
      index: item.index,
      dir: item.dir,
      status: item.status,
      roundsCompleted: item.roundsCompleted,
      failures: [...item.failures],
      marker: item.marker,
    })),
  };
  await controls.exportReport();
  hooks.log(`report exported: ${reportPath}`);
  })();

  return { controls, done };
}

function parseBatchStressRounds(roundsJson: string): BatchStressRound[] {
  const parsed = JSON.parse(roundsJson);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('rounds must be a non-empty array');
  }
  const rounds: BatchStressRound[] = parsed.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`round ${index + 1} is invalid`);
    }
    const prompt = String((item as any).prompt || '').trim();
    if (!prompt) {
      throw new Error(`round ${index + 1} prompt is required`);
    }
    return {
      id: String((item as any).id || `r${index + 1}`),
      prompt,
      waitForRegex: String((item as any).waitForRegex || '').trim() || undefined,
      forbidRegex: String((item as any).forbidRegex || '').trim() || undefined,
      timeoutSec: Number((item as any).timeoutSec || 90),
    };
  });
  return rounds;
}

function renderStressTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => vars[key] ?? '');
}

function emitStressProgress(
  instances: BatchStressInstance[],
  publish: (stats: BatchStressProgress) => void,
): void {
  const total = instances.length;
  let running = 0;
  let succeeded = 0;
  let failed = 0;
  let pending = 0;
  for (const item of instances) {
    if (item.status === 'running') running++;
    else if (item.status === 'succeeded') succeeded++;
    else if (item.status === 'failed') failed++;
    else pending++;
  }
  publish({ total, running, succeeded, failed, pending });
}

async function waitForOutputRegex(
  terminalId: string,
  pattern: string,
  timeoutMs: number,
  offset: number,
  isPaused: () => boolean,
  allMarkers: string[],
  ownMarker?: string,
): Promise<{ ok: boolean; reason?: string }> {
  const re = toRegex(pattern);
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    await waitIfPaused(isPaused);
    const full = terminalOutputBuffers.get(terminalId) || '';
    const segment = full.slice(offset);
    const foreign = ownMarker ? detectForeignMarker(segment, allMarkers, ownMarker) : null;
    if (foreign) return { ok: false, reason: `foreign marker ${foreign}` };
    if (re.test(segment)) return { ok: true };
    await sleep(200);
  }
  return { ok: false, reason: 'timeout' };
}

function toRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'm');
  } catch (err) {
    throw new Error(`Invalid regex "${pattern}": ${formatError(err)}`);
  }
}

function appendTerminalOutput(terminalId: string, data: string): void {
  const prev = terminalOutputBuffers.get(terminalId) || '';
  const plain = stripAnsi(data);
  const next = `${prev}${plain}`;
  const max = 80_000;
  terminalOutputBuffers.set(terminalId, next.length > max ? next.slice(next.length - max) : next);
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

async function waitIfPaused(isPaused: () => boolean): Promise<void> {
  while (isPaused()) {
    await sleep(150);
  }
}

function detectForeignMarker(segment: string, allMarkers: string[], ownMarker: string): string | null {
  for (const marker of allMarkers) {
    if (marker === ownMarker) continue;
    if (segment.includes(`MARK:${marker}`)) return marker;
  }
  return null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function joinPath(base: string, segment: string): string {
  if (!base) return segment;
  const sep = base.includes('\\') ? '\\' : '/';
  const cleanBase = base.endsWith('/') || base.endsWith('\\') ? base.slice(0, -1) : base;
  const cleanSegment = segment.replace(/^[/\\]+/, '');
  return `${cleanBase}${sep}${cleanSegment}`;
}

function findTabByTerminalId(terminalId: string): string | undefined {
  return terminalToTab.get(terminalId);
}

function jumpToNextWaiting() {
  const state = getState();
  const nextWaitingTabId = findNextWaitingTabId(state.activeTabId);
  if (!nextWaitingTabId) return;
  expandGroupForTab(nextWaitingTabId);
  const screenId = getTabScreenId(nextWaitingTabId);
  if (screenId) {
    setActiveScreen(screenId);
  }
  setActiveTab(nextWaitingTabId);
  syncVisibleTerminals();
}

function applyRuntimeSnapshot(snapshot: Record<string, TerminalRuntimeState>) {
  for (const [terminalId, runtimeState] of Object.entries(snapshot)) {
    const tabId = terminalToTab.get(terminalId);
    if (!tabId) continue;
    setTabRuntimeState(tabId, runtimeState);
  }
}

async function openSystemTerminal(configId: string, options?: { cwd?: string }): Promise<void> {
  const config = getState().configs.find(c => c.id === configId);
  if (!config) return;
  const shouldContinue = await runPreflightCheck(config, { interactive: true });
  if (!shouldContinue) {
    return;
  }

  try {
    await window.multiclaude.systemTerminal.open(configId, options);
  } catch (err) {
    alert(`Failed to open system terminal: ${formatError(err)}`);
  }
}

function hasRunningTabsForConfig(configId: string): boolean {
  return getAllTabs().some(tab => tab.configId === configId && tab.status === 'running');
}

async function runPreflightCheck(
  config: ModelConfig,
  options: { interactive: boolean },
): Promise<boolean> {
  let currentConfig = config;
  while (true) {
    currentConfig = getState().configs.find(item => item.id === currentConfig.id) || currentConfig;
    const result = await collectPreflightCheckResult(currentConfig);
    if (!options.interactive) {
      return result.blockers.length === 0;
    }
    if (result.blockers.length === 0 && result.warnings.length === 0) {
      return true;
    }

    const action = await showPreflightDialog({
      configName: currentConfig.name,
      issues: result.issues,
    });
    if (action === 'cancel') return false;
    if (action === 'continue') return true;
    if (action === 'edit-config') {
      openConfigEditor(currentConfig);
      return false;
    }
    if (action === 'install-claude-hooks') {
      try {
        await window.multiclaude.protocol.installClaudeHooks();
      } catch (err) {
        alert(`Failed to install Claude hooks: ${formatError(err)}`);
        return false;
      }
      continue;
    }
    if (action === 'set-transport-pty') {
      await applyConfigEnvPatch(currentConfig, { MC_PROTOCOL_TRANSPORT: '' });
      continue;
    }
    if (action === 'clear-headers-json') {
      await applyConfigEnvPatch(currentConfig, { MC_PROTOCOL_HEADERS_JSON: '' });
      continue;
    }
  }
}

async function collectPreflightCheckResult(config: ModelConfig): Promise<PreflightCheckResult> {
  if (config.provider !== 'claude') {
    return collectPreflightIssues(config);
  }

  try {
    const status = await window.multiclaude.protocol.getClaudeHooksStatus();
    return collectPreflightIssues(config, { claudeHooksStatus: status });
  } catch (err) {
    return collectPreflightIssues(config, { claudeHooksError: formatError(err) });
  }
}

async function applyConfigEnvPatch(config: ModelConfig, patch: Record<string, string>): Promise<void> {
  const customEnvVars = { ...config.customEnvVars };
  for (const [key, value] of Object.entries(patch)) {
    if (!value) {
      delete customEnvVars[key];
    } else {
      customEnvVars[key] = value;
    }
  }
  await window.multiclaude.config.update({ id: config.id, customEnvVars });
  await refreshConfigs();
}

function formatError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

function syncVisibleTerminals(root?: HTMLElement): void {
  const workspaceRoot = root || (document.querySelector('.screen-workspace') as HTMLElement | null);
  if (!workspaceRoot) return;

  const visibleTabIds = getVisibleTabIdsForScreens();
  for (const paneEl of workspaceRoot.querySelectorAll<HTMLElement>('.screen-pane-terminal[data-tab-id]')) {
    const tabId = paneEl.dataset.tabId;
    if (!tabId) continue;
    mountTerminalToHost(tabId, paneEl);
  }
  const activeEl = document.activeElement as HTMLElement | null;
  const isInlineEditing = isScreenWorkspaceInlineEditing() || Boolean(
    activeEl?.closest('.screen-pane-tab-input')
    || activeEl?.closest('.screen-pane-group-input'),
  );
  if (isInlineEditing && (activeEl?.closest('.terminal-view') || activeEl?.closest('.xterm'))) {
    activeEl.blur();
  }
  if (isInlineEditing) {
    blurAllTerminals();
  }
  showTerminals(visibleTabIds, getState().activeTabId, !isInlineEditing);
}

subscribe(() => {
  syncVisibleTerminals();
  const state = getState();
  if (state.activeScreenId !== lastPersistedActiveScreenId) {
    lastPersistedActiveScreenId = state.activeScreenId;
    persistScreenSettings();
  }
});

let lastPersistedActiveScreenId: string | null = null;
init();
