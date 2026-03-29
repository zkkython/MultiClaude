import { ipcMain, BrowserWindow, dialog, Menu, Notification } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { IPC } from '../shared/constants.js';
import * as configStore from './config-store.js';
import { buildEnvForConfig } from './env-builder.js';
import { ensureCodexApiKeyLogin } from './codex-auth.js';
import { spawnPty, writePty, resizePty, killPty } from './pty-manager.js';
import { openSystemTerminal } from './system-terminal.js';
import { AgentStateEngine } from './agent-state-engine.js';
import { ProtocolRunnerBridge } from './protocol-runner-bridge.js';
import type { RunnerEvent, RunnerUserInput } from '../shared/types.js';
import type {
  TerminalSpawnOptions,
  SystemTerminalOpenOptions,
  WorktreeCreateInput,
  WorktreeMergeTemplateInput,
  WorktreeRemoveInput,
} from '../shared/types.js';
import { RunnerOrchestrator } from './runner-orchestrator.js';
import { createSessionTransport } from './runner-transport-factory.js';
import { RunnerSidechannelGateway } from './runner-sidechannel-gateway.js';
import { getClaudeHooksStatus, installClaudeHooksConfig } from './claude-hooks.js';
import { runProtocolConnectivityTest } from './protocol-connectivity.js';
import { buildTerminalContextMenuTemplate } from './terminal-context-menu.js';
import {
  buildMergeTemplate,
  createWorktree,
  getMergeReadiness,
  getWorktreeStatus,
  listWorktrees,
  pruneWorktrees,
  removeWorktree,
} from './worktree-service.js';

let nanoid: (size?: number) => string;
const agentStateEngine = new AgentStateEngine();
const protocolRunnerBridge = new ProtocolRunnerBridge();
let hasWarnedClaudeHooksMissing = false;

async function ensureNanoid() {
  if (!nanoid) {
    const mod = await import('nanoid');
    nanoid = mod.nanoid;
  }
}

const runnerOrchestrator = new RunnerOrchestrator({
  agentStateEngine,
  protocolRunnerBridge,
  createSessionTransport,
  notifyRunnerEvent,
});

const runnerSidechannelGateway = new RunnerSidechannelGateway({
  ingestEvent: (terminalId, event) => {
    runnerOrchestrator.ingestSidechannelEvent(terminalId, event);
  },
});

export function registerIpcHandlers(): void {
  agentStateEngine.setStateListener(({ terminalId, ...runtimeState }) => {
    const wins = BrowserWindow.getAllWindows();
    for (const win of wins) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.TERMINAL_STATE, terminalId, runtimeState);
      }
    }
  });

  // Config handlers
  ipcMain.handle(IPC.CONFIG_GET_ALL, () => {
    return configStore.getAllConfigs();
  });

  ipcMain.handle(IPC.CONFIG_CREATE, async (_event, data) => {
    const config = await configStore.createConfig(data);
    notifyConfigChanged();
    return config;
  });

  ipcMain.handle(IPC.CONFIG_UPDATE, (_event, data) => {
    const config = configStore.updateConfig(data);
    notifyConfigChanged();
    return config;
  });

  ipcMain.handle(IPC.CONFIG_DELETE, (_event, id: string) => {
    configStore.deleteConfig(id);
    notifyConfigChanged();
  });

  ipcMain.handle(IPC.CONFIG_DUPLICATE, async (_event, id: string) => {
    const config = await configStore.duplicateConfig(id);
    notifyConfigChanged();
    return config;
  });

  ipcMain.handle(IPC.CONFIG_EXPORT, async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return false;

    const result = await dialog.showSaveDialog(win, {
      title: 'Export Configurations',
      defaultPath: 'multiclaude-configs.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });

    if (result.canceled || !result.filePath) return false;
    return configStore.exportConfigs(result.filePath);
  });

  ipcMain.handle(IPC.CONFIG_IMPORT, async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      title: 'Import Configurations',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    const importResult = await configStore.importConfigs(result.filePaths[0]);
    if (importResult.imported > 0) {
      notifyConfigChanged();
    }
    return importResult;
  });

  // Terminal handlers
  ipcMain.handle(IPC.TERMINAL_SPAWN, async (_event, configId: string, options?: TerminalSpawnOptions) => {
    await ensureNanoid();
    const config = configStore.getConfigById(configId);
    if (!config) {
      throw new Error(`Config not found: ${configId}`);
    }

    const terminalId = nanoid(12);
    const env = buildEnvForConfig(config);
    await ensureCodexApiKeyLogin(config, env);
    if (config.provider === 'claude') {
      const status = await getClaudeHooksStatus();
      if (!status.installed && !hasWarnedClaudeHooksMissing) {
        hasWarnedClaudeHooksMissing = true;
        console.warn('Claude hooks are not fully installed; waiting detection may degrade.', {
          settingsPath: status.settingsPath,
          missingEvents: status.missingEvents,
          error: status.error,
        });
      }
    }
    try {
      await runnerSidechannelGateway.injectEnv(terminalId, env);
    } catch (err) {
      console.warn('Failed to start runner sidechannel server:', err);
    }
    agentStateEngine.registerTerminal(terminalId);

    spawnPty(
      terminalId,
      env,
      (data: string) => {
        const displayData = agentStateEngine.onOutput(terminalId, data);
        runnerOrchestrator.ingestTerminalOutput(terminalId, data);
        if (displayData) {
          notifyTerminalData(terminalId, displayData);
        }
      },
      (code: number) => {
        agentStateEngine.onExit(terminalId);
        runnerOrchestrator.cleanupTerminal(terminalId);
        runnerSidechannelGateway.cleanupTerminal(terminalId);
        notifyTerminalExit(terminalId, code);
      },
      options,
    );

    return { terminalId };
  });

  ipcMain.on(IPC.TERMINAL_WRITE, (_event, terminalId: string, data: string) => {
    agentStateEngine.onInput(terminalId, data);
    writePty(terminalId, data);
  });

  ipcMain.on(IPC.TERMINAL_RESIZE, (_event, terminalId: string, cols: number, rows: number) => {
    resizePty(terminalId, cols, rows);
  });

  ipcMain.on(IPC.TERMINAL_KILL, (_event, terminalId: string) => {
    agentStateEngine.onExit(terminalId);
    killPty(terminalId);
    agentStateEngine.unregisterTerminal(terminalId);
    runnerOrchestrator.cleanupTerminal(terminalId);
    runnerSidechannelGateway.cleanupTerminal(terminalId);
  });

  ipcMain.handle(IPC.TERMINAL_STATE_SNAPSHOT_GET, () => {
    return agentStateEngine.getSnapshot();
  });

  // Protocol runner bridge handlers
  ipcMain.handle(IPC.RUNNER_SESSION_START, async (_event, configId: string, terminalId?: string) => {
    await ensureNanoid();
    const config = configStore.getConfigById(configId);
    if (!config) {
      throw new Error(`Config not found: ${configId}`);
    }

    const sessionId = `runner-${nanoid(12)}`;
    return runnerOrchestrator.startSession({ sessionId, config, terminalId });
  });

  ipcMain.handle(IPC.RUNNER_EVENT_INGEST, (_event, sessionId: string, rawEvent: unknown) => {
    runnerOrchestrator.ingestRawEvent(sessionId, rawEvent);
  });

  ipcMain.handle(IPC.RUNNER_INPUT_RESOLVE, (_event, sessionId: string, requestId: string) => {
    return runnerOrchestrator.resolveInput(sessionId, requestId);
  });

  ipcMain.handle(IPC.RUNNER_INPUT_SUBMIT, (_event, input: RunnerUserInput) => {
    return runnerOrchestrator.submitInput(input);
  });

  ipcMain.handle(IPC.RUNNER_SESSION_INTERRUPT, (_event, sessionId: string) => {
    return runnerOrchestrator.interruptSession(sessionId);
  });

  ipcMain.handle(IPC.RUNNER_SESSION_STOP, (_event, sessionId: string) => {
    return runnerOrchestrator.stopSession(sessionId);
  });

  ipcMain.handle(IPC.RUNNER_SESSION_END, (_event, sessionId: string) => {
    runnerOrchestrator.endSession(sessionId);
  });

  ipcMain.handle(IPC.RUNNER_METRICS_GET, () => {
    return runnerOrchestrator.getMetricsSnapshot();
  });

  ipcMain.handle(IPC.RUNNER_METRICS_RESET, () => {
    runnerOrchestrator.resetMetrics();
  });

  ipcMain.handle(IPC.RUNNER_CONNECTIVITY_TEST, async (_event, input: ProtocolConnectivityCheckInput) => {
    return await runProtocolConnectivityTest(input);
  });

  ipcMain.handle(IPC.RUNNER_CLAUDE_HOOKS_STATUS_GET, async () => {
    return await getClaudeHooksStatus();
  });

  ipcMain.handle(IPC.RUNNER_CLAUDE_HOOKS_INSTALL, async () => {
    await installClaudeHooksConfig();
    return await getClaudeHooksStatus();
  });

  // System terminal
  ipcMain.handle(IPC.SYSTEM_TERMINAL_OPEN, async (_event, configId: string, options?: SystemTerminalOpenOptions) => {
    const config = configStore.getConfigById(configId);
    if (!config) {
      throw new Error(`Config not found: ${configId}`);
    }
    await openSystemTerminal(config, options);
  });

  // Context menu
  ipcMain.on(IPC.CONTEXT_MENU_SHOW, (event, terminalId: string, hasSelection: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const template = buildTerminalContextMenuTemplate(win, terminalId, hasSelection);

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: win });
  });

  // Settings
  ipcMain.handle(IPC.APP_GET_SETTINGS, () => {
    return configStore.getSettings();
  });

  ipcMain.handle(IPC.APP_SAVE_SETTINGS, (_event, settings) => {
    configStore.saveSettings(settings);
  });

  ipcMain.handle(IPC.APP_SELECT_DIRECTORY, async (_event, defaultPath?: string) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      defaultPath: defaultPath && defaultPath.trim() ? defaultPath : undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IPC.APP_ENSURE_DIRECTORY, async (_event, targetPath: string) => {
    const normalized = String(targetPath || '').trim();
    if (!normalized) {
      throw new Error('Directory path is required');
    }
    await fs.mkdir(normalized, { recursive: true });
    return normalized;
  });

  ipcMain.handle(IPC.APP_WRITE_TEXT_FILE, async (_event, targetPath: string, content: string) => {
    const normalized = String(targetPath || '').trim();
    if (!normalized) {
      throw new Error('File path is required');
    }
    await fs.mkdir(path.dirname(normalized), { recursive: true });
    await fs.writeFile(normalized, String(content ?? ''), 'utf8');
    return normalized;
  });

  ipcMain.handle(IPC.APP_SET_IGNORE_MENU_SHORTCUTS, (event, ignore: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    win.webContents.setIgnoreMenuShortcuts(Boolean(ignore));
  });

  ipcMain.handle(IPC.WORKTREE_LIST, async (_event, repoPath: string) => {
    return await listWorktrees(repoPath);
  });

  ipcMain.handle(IPC.WORKTREE_CREATE, async (_event, input: WorktreeCreateInput) => {
    return await createWorktree(input);
  });

  ipcMain.handle(IPC.WORKTREE_REMOVE, async (_event, input: WorktreeRemoveInput) => {
    await removeWorktree(input.repoPath, input.worktreePath);
  });

  ipcMain.handle(IPC.WORKTREE_PRUNE, async (_event, repoPath: string) => {
    await pruneWorktrees(repoPath);
  });

  ipcMain.handle(IPC.WORKTREE_STATUS, async (_event, worktreePath: string) => {
    return await getWorktreeStatus(worktreePath);
  });

  ipcMain.handle(IPC.WORKTREE_MERGE_READINESS, async (_event, worktreePath: string, targetRef: string) => {
    return await getMergeReadiness(worktreePath, targetRef);
  });

  ipcMain.handle(IPC.WORKTREE_MERGE_TEMPLATE, async (_event, input: WorktreeMergeTemplateInput) => {
    return buildMergeTemplate(input);
  });
}

function notifyConfigChanged(): void {
  const wins = BrowserWindow.getAllWindows();
  for (const win of wins) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.CONFIG_CHANGED);
    }
  }
}

function notifyRunnerEvent(event: RunnerEvent): void {
  const wins = BrowserWindow.getAllWindows();
  for (const win of wins) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.RUNNER_EVENT, event);
    }
  }
}

function notifyTerminalData(terminalId: string, data: string): void {
  const wins = BrowserWindow.getAllWindows();
  for (const win of wins) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.TERMINAL_DATA, terminalId, data);
    }
  }
}

function notifyTerminalExit(terminalId: string, code: number): void {
  const wins = BrowserWindow.getAllWindows();
  for (const win of wins) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.TERMINAL_EXIT, terminalId, code);
    }
  }
}
