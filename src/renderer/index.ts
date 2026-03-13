import {
  getState, setState, subscribe,
  addTab, removeTab, updateTabStatus, setActiveTab,
  nextTab, prevTab, goToTab,
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
import type { ModelConfig, TerminalTab } from '../shared/types.js';

// Tab ID -> terminal ID mapping
const tabToTerminal = new Map<string, string>();
const terminalToTab = new Map<string, string>();

async function init() {
  // Load settings
  const settings = await window.multiclaude.app.getSettings();
  setState({ sidebarWidth: settings.sidebarWidth });

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

  const tabBar = createTerminalTabs(handleTabSelect, handleTabClose);
  const termContainer = createTerminalContainer();
  const welcomeScreen = createWelcomeScreen();
  const statusBar = createStatusBar();

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

  // Listen for config changes from main process
  window.multiclaude.menu.onAction(handleMenuAction);

  // Listen for config:changed (re-fetch configs)
  // We'll poll on config operations since we trigger them

  // Initial visibility
  const state = getState();
  welcomeScreen.style.display = state.configs.length === 0 ? 'flex' : 'none';
  termContainer.style.display = 'none';
}

function handleSidebarAction(action: SidebarAction) {
  switch (action.type) {
    case 'select-config':
      setState({ selectedConfigId: action.configId });
      break;
    case 'new-terminal':
      spawnTerminal(action.configId);
      break;
    case 'system-terminal':
      openSystemTerminal(action.configId);
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

async function spawnTerminal(configId: string) {
  const config = getState().configs.find(c => c.id === configId);
  if (!config) return;
  const launchIssue = getConfigLaunchIssue(config);
  if (launchIssue) {
    alert(launchIssue);
    return;
  }

  try {
    const { terminalId } = await window.multiclaude.terminal.spawn(configId);
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
    };

    addTab(tab);

    // Create terminal view
    const termContainer = document.querySelector('.terminal-container')!;
    createTerminalView(termContainer as HTMLElement, tabId, terminalId, config.color);
    showTerminal(tabId);
  } catch (err) {
    console.error('Failed to spawn terminal:', err);
    alert(`Failed to open terminal: ${formatError(err)}`);
  }
}

function handleTabSelect(tabId: string) {
  setActiveTab(tabId);
  showTerminal(tabId);
}

function handleTabClose(tabId: string) {
  const terminalId = tabToTerminal.get(tabId);
  if (terminalId) {
    window.multiclaude.terminal.kill(terminalId);
    terminalToTab.delete(terminalId);
    tabToTerminal.delete(tabId);
  }
  destroyTerminal(tabId);
  removeTab(tabId);

  // Show remaining active tab
  const state = getState();
  if (state.activeTabId) {
    showTerminal(state.activeTabId);
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
  const configs = await window.multiclaude.config.getAll();
  const state = getState();
  setState({
    configs,
    selectedConfigId: state.selectedConfigId && configs.find(c => c.id === state.selectedConfigId)
      ? state.selectedConfigId
      : configs.length > 0 ? configs[0].id : null,
  });
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
      // Focus sidebar
      setState({ sidebarVisible: true });
      break;
  }
}

function findTabByTerminalId(terminalId: string): string | undefined {
  return terminalToTab.get(terminalId);
}

async function openSystemTerminal(configId: string): Promise<void> {
  const config = getState().configs.find(c => c.id === configId);
  if (!config) return;
  const launchIssue = getConfigLaunchIssue(config);
  if (launchIssue) {
    alert(launchIssue);
    return;
  }

  try {
    await window.multiclaude.systemTerminal.open(configId);
  } catch (err) {
    alert(`Failed to open system terminal: ${formatError(err)}`);
  }
}

function hasRunningTabsForConfig(configId: string): boolean {
  return getState().tabs.some(tab => tab.configId === configId && tab.status === 'running');
}

function getConfigLaunchIssue(config: ModelConfig): string | null {
  const codexApiEnvKey = (config.codexApiKeyEnvKey || 'OPENAI_API_KEY').trim();
  const customModel = config.provider === 'codex'
    ? (config.customEnvVars['OPENAI_MODEL'] || '').trim()
    : (config.customEnvVars['ANTHROPIC_MODEL'] || '').trim();
  const customKey = config.provider === 'codex'
    ? ((config.customEnvVars[codexApiEnvKey] || config.customEnvVars['OPENAI_API_KEY'] || '').trim())
    : (config.customEnvVars['ANTHROPIC_AUTH_TOKEN'] || '').trim();

  if (config.provider === 'codex') {
    if (!config.openaiModel.trim() && !customModel) return `Config "${config.name}" is missing OPENAI model.`;
    if (!config.openaiApiKey.trim() && !customKey) return `Config "${config.name}" is missing OPENAI API key.`;
    return null;
  }

  if (!config.anthropicModel.trim() && !customModel) return `Config "${config.name}" is missing Claude model.`;
  if (!config.anthropicAuthToken.trim() && !customKey) return `Config "${config.name}" is missing Claude auth token.`;
  return null;
}

function formatError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

// Subscribe to active tab changes to show correct terminal
subscribe(() => {
  const state = getState();
  if (state.activeTabId) {
    showTerminal(state.activeTabId);
  }
});

init();
