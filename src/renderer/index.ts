import {
  getState, setState, subscribe,
  addTab, removeTab, updateTabStatus, setActiveTab,
  nextTab, prevTab, goToTab,
  getGroupTabIds, autoGroupByConfig,
  findNextWaitingTabId, setProtocolMetrics, setTabRuntimeState, removeTabRuntimeState, expandGroupForTab,
} from './state/store.js';
import { createSidebar, type SidebarAction } from './components/Sidebar.js';
import { showConfigEditor, type ConfigEditorResult } from './components/ConfigEditor.js';
import { createTerminalTabs } from './components/TerminalTabs.js';
import {
  createTerminalContainer, createTerminalView, writeToTerminal,
  showTerminal, destroyTerminal, fitAllTerminals, clearTerminal,
  selectAllInTerminal, copyFromTerminal, pasteToTerminal, setTerminalFontSize,
  getTerminalIdForTab,
} from './components/TerminalView.js';
import { createWelcomeScreen } from './components/WelcomeScreen.js';
import { createStatusBar } from './components/StatusBar.js';
import { showPreferencesEditor } from './components/PreferencesEditor.js';
import { showPreflightDialog } from './components/PreflightDialog.js';
import { showWorktreeLauncher } from './components/WorktreeLauncher.js';
import { collectPreflightIssues, type PreflightCheckResult } from './preflight.js';
import type {
  ModelConfig,
  RuntimeState,
  RuntimeStateConfidence,
  RunnerEvent,
  TerminalRuntimeState,
  TerminalTab,
  TabGroup,
  TabGroupPersisted,
  WorkspaceSnapshotV1,
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
let workspaceSnapshotSaveTimer: ReturnType<typeof setTimeout> | null = null;
let isRestoringWorkspace = false;

async function init() {
  // Load settings
  const settings = await window.multiclaude.app.getSettings();
  // Restore groups from persisted settings
  const persistedGroups: TabGroupPersisted[] = settings.groups || [];
  const groups: TabGroup[] = persistedGroups.map(pg => ({
    ...pg,
    collapsed: false,
    tabIds: [],
  }));
  setState({ sidebarWidth: settings.sidebarWidth, groups });
  setState({ useWebglRenderer: Boolean(settings.useWebglRenderer) });
  setState({
    restoreOnLaunch: settings.restoreOnLaunch !== false,
    restorePromptOnLaunch: settings.restorePromptOnLaunch !== false,
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

  const tabBar = createTerminalTabs(handleTabSelect, handleTabClose, handleCloseGroupTabs, handleGroupsChanged);
  const termContainer = createTerminalContainer();
  const welcomeScreen = createWelcomeScreen();
  const statusBar = createStatusBar(() => {
    jumpToNextWaiting();
  });

  mainArea.appendChild(tabBar);
  mainArea.appendChild(termContainer);
  mainArea.appendChild(welcomeScreen);

  appEl.appendChild(sidebar);
  appEl.appendChild(mainArea);
  appEl.appendChild(statusBar);

  // Show/hide welcome screen and sidebar based on state
  subscribe(() => {
    const state = getState();
    const hasConfigs = state.configs.length > 0;
    const hasTabs = state.tabs.length > 0;

    sidebar.style.display = state.sidebarVisible ? 'flex' : 'none';
    welcomeScreen.style.display = (!hasConfigs && !hasTabs) ? 'flex' : 'none';
    termContainer.style.display = hasTabs ? 'flex' : 'none';
  });
  subscribe(scheduleWorkspaceSnapshotSave);

  // Welcome screen create button
  document.getElementById('welcome-create-btn')?.addEventListener('click', () => {
    openConfigEditor(null);
  });

  // Listen for PTY data
  window.multiclaude.terminal.onData((terminalId, data) => {
    const tabId = terminalToTab.get(terminalId);
    if (tabId) {
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
  welcomeScreen.style.display = state.configs.length === 0 ? 'flex' : 'none';
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

  await maybeRestoreWorkspaceOnLaunch();
}

function handleSidebarAction(action: SidebarAction) {
  switch (action.type) {
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
  restoredRuntimeState?: RuntimeState;
  skipFocus?: boolean;
  interactivePreflight?: boolean;
  cwd?: string;
}

async function spawnTerminal(configId: string, options: SpawnTerminalOptions = {}): Promise<string | null> {
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
      showTerminal(tabId);
    }
    void startRunnerSessionForTab(tabId, config.id, terminalId);

    if (options.restoredRuntimeState && options.restoredRuntimeState !== 'running') {
      setTabRuntimeState(
        tabId,
        buildRuntimeState(
          options.restoredRuntimeState,
          'restored from last workspace snapshot',
          Date.now(),
          'low',
        ),
      );
    }

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
  }
}

function handleTabSelect(tabId: string) {
  setActiveTab(tabId);
  showTerminal(tabId);
}

function handleTabClose(tabId: string) {
  void endRunnerSessionForTab(tabId);
  const terminalId = tabToTerminal.get(tabId);
  if (terminalId) {
    window.multiclaude.terminal.kill(terminalId);
    terminalToTab.delete(terminalId);
    tabToTerminal.delete(tabId);
  }
  removeTabRuntimeState(tabId);
  runnerLastEventByTab.delete(tabId);
  runnerTransportByTab.delete(tabId);
  destroyTerminal(tabId);
  removeTab(tabId);

  // Show remaining active tab
  const state = getState();
  if (state.activeTabId) {
    showTerminal(state.activeTabId);
  }
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
      const tab = getState().tabs.find(t => t.id === tabId);
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
    const groups = state.groups.map(g => ({
      ...g,
      associatedConfigIds: g.associatedConfigIds.filter(cid => configIds.has(cid)),
    }));
    setState({
      configs,
      groups,
      selectedConfigId: state.selectedConfigId && configs.find(c => c.id === state.selectedConfigId)
        ? state.selectedConfigId
        : configs.length > 0 ? configs[0].id : null,
    });
    saveGroupsToSettings();
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
      if (getState().activeTabId) showTerminal(getState().activeTabId!);
      break;
    case 'prev-tab':
      prevTab();
      if (getState().activeTabId) showTerminal(getState().activeTabId!);
      break;
    case 'go-to-tab':
      goToTab(payload as number);
      if (getState().activeTabId) showTerminal(getState().activeTabId!);
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
      setState({ sidebarVisible: !state.sidebarVisible });
      requestAnimationFrame(fitAllTerminals);
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
          const tab = state.tabs.find(t => t.id === tabId);
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
    case 'restore-last-workspace':
      await restoreWorkspaceFromSnapshot();
      break;
    case 'auto-group-by-config':
      autoGroupByConfig();
      saveGroupsToSettings();
      break;
  }
}

function handleCloseGroupTabs(groupId: string) {
  const tabIds = getGroupTabIds(groupId);
  for (const tabId of tabIds) {
    handleTabClose(tabId);
  }
}

function handleGroupsChanged() {
  saveGroupsToSettings();
}

function saveGroupsToSettings() {
  const state = getState();
  const persisted: TabGroupPersisted[] = state.groups.map(g => ({
    id: g.id,
    name: g.name,
    color: g.color,
    associatedConfigIds: g.associatedConfigIds,
  }));
  window.multiclaude.app.saveSettings({ groups: persisted });
}

function openPreferences() {
  const state = getState();
  showPreferencesEditor(
    {
      sidebarWidth: state.sidebarWidth,
      groups: state.groups,
      useWebglRenderer: state.useWebglRenderer,
      restoreOnLaunch: state.restoreOnLaunch,
      restorePromptOnLaunch: state.restorePromptOnLaunch,
    },
    async (result) => {
      setState({
        useWebglRenderer: result.useWebglRenderer,
        restoreOnLaunch: result.restoreOnLaunch,
        restorePromptOnLaunch: result.restorePromptOnLaunch,
      });
      await window.multiclaude.app.saveSettings({
        useWebglRenderer: result.useWebglRenderer,
        restoreOnLaunch: result.restoreOnLaunch,
        restorePromptOnLaunch: result.restorePromptOnLaunch,
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

function scheduleWorkspaceSnapshotSave(): void {
  if (isRestoringWorkspace) return;
  if (workspaceSnapshotSaveTimer) {
    clearTimeout(workspaceSnapshotSaveTimer);
  }
  workspaceSnapshotSaveTimer = setTimeout(() => {
    workspaceSnapshotSaveTimer = null;
    void persistWorkspaceSnapshot();
  }, 500);
}

async function persistWorkspaceSnapshot(): Promise<void> {
  const state = getState();
  if (state.tabs.length === 0) {
    await window.multiclaude.app.clearWorkspaceSnapshot();
    return;
  }

  const activeTabIndex = Math.max(0, state.tabs.findIndex(tab => tab.id === state.activeTabId));
  const snapshot: WorkspaceSnapshotV1 = {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    activeTabIndex,
    tabs: state.tabs.map((tab) => ({
      configId: tab.configId,
      customName: tab.customName,
      runtimeState: tab.status === 'exited' ? 'exited' : (getState().runtimeStatesByTabId[tab.id]?.state || 'running'),
    })),
  };
  await window.multiclaude.app.saveWorkspaceSnapshot(snapshot);
}

async function maybeRestoreWorkspaceOnLaunch(): Promise<void> {
  const state = getState();
  if (!state.restoreOnLaunch) return;
  if (state.tabs.length > 0) return;

  const snapshot = await window.multiclaude.app.getWorkspaceSnapshot();
  if (!snapshot || snapshot.tabs.length === 0) return;

  if (state.restorePromptOnLaunch) {
    const shouldRestore = confirm(`Restore ${snapshot.tabs.length} terminal tab(s) from last workspace?`);
    if (!shouldRestore) return;
  }
  await restoreWorkspaceFromSnapshot(snapshot);
}

async function restoreWorkspaceFromSnapshot(explicitSnapshot?: WorkspaceSnapshotV1 | null): Promise<void> {
  const snapshot = explicitSnapshot ?? await window.multiclaude.app.getWorkspaceSnapshot();
  if (!snapshot || snapshot.tabs.length === 0) {
    alert('No workspace snapshot available.');
    return;
  }
  if (getState().tabs.length > 0 && !confirm('Current workspace has open tabs. Restore from snapshot anyway?')) {
    return;
  }

  isRestoringWorkspace = true;
  const restoredTabIds: string[] = [];
  const missingConfigIds = new Set<string>();
  try {
    for (const tab of getState().tabs.slice()) {
      handleTabClose(tab.id);
    }

    for (const tabSnapshot of snapshot.tabs) {
      if (tabSnapshot.runtimeState === 'exited') continue;
      const config = getState().configs.find(item => item.id === tabSnapshot.configId);
      if (!config) {
        missingConfigIds.add(tabSnapshot.configId);
        continue;
      }
      const restoredTabId = await spawnTerminal(tabSnapshot.configId, {
        customName: tabSnapshot.customName,
        restoredRuntimeState: tabSnapshot.runtimeState,
        skipFocus: true,
        interactivePreflight: false,
      });
      if (restoredTabId) {
        restoredTabIds.push(restoredTabId);
      }
    }
  } finally {
    isRestoringWorkspace = false;
  }

  if (restoredTabIds.length > 0) {
    const index = Math.max(0, Math.min(snapshot.activeTabIndex, restoredTabIds.length - 1));
    const tabId = restoredTabIds[index];
    setActiveTab(tabId);
    showTerminal(tabId);
  }

  if (missingConfigIds.size > 0) {
    alert(`Some tabs were skipped because configs are missing:\n${Array.from(missingConfigIds).join('\n')}`);
  }
}

function findTabByTerminalId(terminalId: string): string | undefined {
  return terminalToTab.get(terminalId);
}

function jumpToNextWaiting() {
  const state = getState();
  const nextWaitingTabId = findNextWaitingTabId(state.activeTabId);
  if (!nextWaitingTabId) return;
  expandGroupForTab(nextWaitingTabId);
  setActiveTab(nextWaitingTabId);
  showTerminal(nextWaitingTabId);
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
  return getState().tabs.some(tab => tab.configId === configId && tab.status === 'running');
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

// Subscribe to active tab changes to show correct terminal
let lastFocusedTabId: string | null = null;
subscribe(() => {
  const state = getState();
  if (!state.activeTabId) {
    lastFocusedTabId = null;
    return;
  }
  if (state.activeTabId !== lastFocusedTabId) {
    lastFocusedTabId = state.activeTabId;
    showTerminal(state.activeTabId);
  }
});

window.addEventListener('beforeunload', () => {
  void persistWorkspaceSnapshot();
});

init();
