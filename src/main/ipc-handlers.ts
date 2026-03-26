import { ipcMain, BrowserWindow, dialog, Menu, Notification } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { IPC } from '../shared/constants.js';
import * as configStore from './config-store.js';
import { buildEnvForConfig } from './env-builder.js';
import { ensureCodexApiKeyLogin } from './codex-auth.js';
import { spawnPty, writePty, resizePty, killPty } from './pty-manager.js';
import { openSystemTerminal } from './system-terminal.js';
import { AgentStateEngine } from './agent-state-engine.js';
import { ProtocolRunnerBridge } from './protocol-runner-bridge.js';
import type { RunnerEvent, RunnerUserInput } from '../shared/types.js';
import type { ProtocolConnectivityCheckInput, ProtocolConnectivityCheckResult } from '../shared/types.js';
import type { ClaudeHooksStatus } from '../shared/types.js';
import type {
  TerminalSpawnOptions,
  SystemTerminalOpenOptions,
  WorktreeCreateInput,
  WorktreeMergeTemplateInput,
  WorktreeRemoveInput,
} from '../shared/types.js';
import { RunnerOrchestrator } from './runner-orchestrator.js';
import { createSessionTransport, inferHttpSseDefaultsFromInput } from './runner-transport-factory.js';
import { RunnerSidechannelGateway } from './runner-sidechannel-gateway.js';
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
const CLAUDE_HOOK_EVENTS = [
  'Stop',
  'SubagentStop',
  'Notification',
  'PermissionRequest',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'SessionStart',
] as const;
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

    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'Copy',
        enabled: hasSelection,
        click: () => win.webContents.send(IPC.MENU_ACTION, 'copy'),
      },
      {
        label: 'Paste',
        click: () => win.webContents.send(IPC.MENU_ACTION, 'paste'),
      },
      {
        label: 'Select All',
        click: () => win.webContents.send(IPC.MENU_ACTION, 'select-all', terminalId),
      },
      { type: 'separator' },
      {
        label: 'Clear Terminal',
        click: () => win.webContents.send(IPC.MENU_ACTION, 'clear-terminal', terminalId),
      },
      { type: 'separator' },
      {
        label: 'Open System Terminal',
        click: () => win.webContents.send(IPC.MENU_ACTION, 'open-system-terminal', terminalId),
      },
    ];

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

async function getClaudeHooksStatus(): Promise<ClaudeHooksStatus> {
  const info = await resolveClaudeHookIntegrationInfo();
  if (!info.scriptExists) {
    return {
      installed: false,
      settingsPath: info.settingsPath,
      hookScriptPath: info.hookScriptPath,
      command: info.command,
      missingEvents: [...CLAUDE_HOOK_EVENTS],
      error: 'hook script not found',
    };
  }
  try {
    const settings = await readClaudeSettingsObject(info.settingsPath);
    const hooks = ensureRecord(settings, 'hooks');
    const missingEvents = CLAUDE_HOOK_EVENTS.filter((eventName) => !hasHookEntry(hooks, eventName, info.command));
    return {
      installed: missingEvents.length === 0,
      settingsPath: info.settingsPath,
      hookScriptPath: info.hookScriptPath,
      command: info.command,
      missingEvents,
    };
  } catch (err) {
    return {
      installed: false,
      settingsPath: info.settingsPath,
      hookScriptPath: info.hookScriptPath,
      command: info.command,
      missingEvents: [...CLAUDE_HOOK_EVENTS],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function installClaudeHooksConfig(): Promise<void> {
  const info = await resolveClaudeHookIntegrationInfo();
  if (!info.scriptExists) {
    throw new Error(`hook script not found: ${info.hookScriptPath}`);
  }
  const settings = await readClaudeSettingsObject(info.settingsPath);
  const hooks = ensureRecord(settings, 'hooks');
  for (const eventName of CLAUDE_HOOK_EVENTS) {
    ensureHookEntry(hooks, eventName, info.command);
  }
  await fs.mkdir(path.dirname(info.settingsPath), { recursive: true });
  await fs.writeFile(info.settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

async function resolveClaudeHookIntegrationInfo(): Promise<{
  hookScriptPath: string;
  settingsPath: string;
  command: string;
  scriptExists: boolean;
}> {
  const settingsPath = path.resolve(os.homedir(), '.claude/settings.json');
  const packagedUnpackedHookPath = path.resolve(process.resourcesPath, 'app.asar.unpacked/dist/hooks/claude-runner-sidechannel.js');
  const packagedAsarHookPath = path.resolve(process.resourcesPath, 'app.asar/dist/hooks/claude-runner-sidechannel.js');
  const candidates = [
    packagedUnpackedHookPath,
    packagedAsarHookPath,
    path.resolve(process.cwd(), 'scripts/hooks/claude-runner-sidechannel.js'),
    path.resolve(__dirname, '../../scripts/hooks/claude-runner-sidechannel.js'),
    path.resolve(__dirname, '../hooks/claude-runner-sidechannel.js'),
  ];
  let hookScriptPath = candidates[0];
  let scriptExists = false;
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      hookScriptPath = candidate;
      scriptExists = true;
      break;
    } catch {
      // continue
    }
  }
  return {
    hookScriptPath,
    settingsPath,
    command: `node ${quoteShellArg(hookScriptPath)}`,
    scriptExists,
  };
}

function quoteShellArg(input: string): string {
  return `'${input.replace(/'/g, `'\\''`)}'`;
}

async function readClaudeSettingsObject(settingsPath: string): Promise<Record<string, unknown>> {
  let raw = '';
  try {
    raw = await fs.readFile(settingsPath, 'utf8');
  } catch (err: any) {
    if (err && err.code === 'ENOENT') {
      return {};
    }
    throw err;
  }
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid settings root (must be JSON object)');
  }
  return parsed as Record<string, unknown>;
}

function ensureRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

function ensureHookEntry(hooks: Record<string, unknown>, eventName: string, command: string): void {
  let eventList: Array<Record<string, unknown>> = [];
  const current = hooks[eventName];
  if (Array.isArray(current)) {
    eventList = current.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  }

  const hasCommand = eventList.some((entry) => {
    const hookItems = entry.hooks;
    if (!Array.isArray(hookItems)) return false;
    return hookItems.some((hookItem) => {
      if (!hookItem || typeof hookItem !== 'object' || Array.isArray(hookItem)) return false;
      const record = hookItem as Record<string, unknown>;
      return record.type === 'command' && record.command === command;
    });
  });

  if (hasCommand) {
    hooks[eventName] = eventList;
    return;
  }

  const commandHook = {
    type: 'command',
    command,
  };
  if (eventName === 'PreToolUse' || eventName === 'PostToolUse') {
    eventList.push({
      matcher: '*',
      hooks: [commandHook],
    });
  } else {
    eventList.push({
      hooks: [commandHook],
    });
  }
  hooks[eventName] = eventList;
}

function hasHookEntry(hooks: Record<string, unknown>, eventName: string, command: string): boolean {
  const current = hooks[eventName];
  if (!Array.isArray(current)) return false;
  for (const entry of current) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const hookItems = (entry as Record<string, unknown>).hooks;
    if (!Array.isArray(hookItems)) continue;
    for (const hookItem of hookItems) {
      if (!hookItem || typeof hookItem !== 'object' || Array.isArray(hookItem)) continue;
      const record = hookItem as Record<string, unknown>;
      if (record.type === 'command' && record.command === command) {
        return true;
      }
    }
  }
  return false;
}

async function runProtocolConnectivityTest(input: ProtocolConnectivityCheckInput): Promise<ProtocolConnectivityCheckResult> {
  const customEnv = input.customEnvVars ?? {};
  const transportType = ((customEnv['MC_PROTOCOL_TRANSPORT'] || '').trim().toLowerCase() === 'http_sse')
    ? 'http_sse'
    : 'pty';
  if (transportType === 'pty') {
    return {
      ok: true,
      transportType,
      summary: 'Transport is PTY. Protocol connectivity test skipped.',
      details: [
        {
          name: 'transport',
          ok: true,
          message: 'PTY mode does not require remote protocol endpoints.',
        },
      ],
    };
  }

  const defaults = inferHttpSseDefaultsFromInput(input);
  const streamUrl = (customEnv['MC_PROTOCOL_STREAM_URL'] || '').trim() || defaults.streamUrl;
  const inputUrl = (customEnv['MC_PROTOCOL_INPUT_URL'] || '').trim() || defaults.inputUrl;
  const interruptUrl = (customEnv['MC_PROTOCOL_INTERRUPT_URL'] || '').trim() || defaults.interruptUrl;
  const stopUrl = (customEnv['MC_PROTOCOL_STOP_URL'] || '').trim() || defaults.stopUrl;
  const headers: Record<string, string> = { ...defaults.headers };

  const authHeader = (customEnv['MC_PROTOCOL_AUTH_HEADER'] || '').trim();
  const authToken = (customEnv['MC_PROTOCOL_AUTH_TOKEN'] || '').trim();
  if (authHeader && authToken) {
    headers[authHeader] = authToken;
  }

  const checks: ProtocolConnectivityCheckResult['details'] = [];
  checks.push(await checkEndpoint('stream', streamUrl, 'GET', headers));
  checks.push(await checkEndpoint('input', inputUrl, 'POST', headers, {
    sessionId: 'connectivity-test',
    requestId: 'connectivity-test',
    type: 'user_response',
    text: 'ping',
  }));
  if (interruptUrl) {
    checks.push(await checkEndpoint('interrupt', interruptUrl, 'POST', headers, {
      sessionId: 'connectivity-test',
    }));
  }
  if (stopUrl) {
    checks.push(await checkEndpoint('stop', stopUrl, 'POST', headers, {
      sessionId: 'connectivity-test',
    }));
  }

  const ok = checks.every(item => item.ok);
  return {
    ok,
    transportType,
    summary: ok ? 'All protocol endpoint checks passed.' : 'One or more protocol endpoint checks failed.',
    details: checks,
  };
}

async function checkEndpoint(
  name: string,
  url: string | undefined,
  method: 'GET' | 'POST',
  headers: Record<string, string>,
  body?: Record<string, unknown>
): Promise<{ name: string; ok: boolean; status?: number; message: string; url?: string }> {
  if (!url) {
    return {
      name,
      ok: false,
      message: 'Missing URL',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  if (typeof (timeout as any).unref === 'function') {
    (timeout as any).unref();
  }

  try {
    const response = await fetch(url, {
      method,
      headers: {
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      signal: controller.signal,
    });
    return {
      name,
      ok: response.ok,
      status: response.status,
      message: response.ok ? 'ok' : `HTTP ${response.status}`,
      url,
    };
  } catch (err) {
    return {
      name,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      url,
    };
  } finally {
    clearTimeout(timeout);
  }
}
