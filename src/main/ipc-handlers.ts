import { ipcMain, BrowserWindow, dialog, Menu, Notification } from 'electron';
import * as http from 'http';
import { randomBytes } from 'crypto';
import { IPC } from '../shared/constants.js';
import * as configStore from './config-store.js';
import { buildEnvForConfig } from './env-builder.js';
import { ensureCodexApiKeyLogin } from './codex-auth.js';
import { spawnPty, writePty, resizePty, killPty } from './pty-manager.js';
import { openSystemTerminal } from './system-terminal.js';
import { AgentStateEngine } from './agent-state-engine.js';
import { ProtocolRunnerBridge } from './protocol-runner-bridge.js';
import type { RunnerUserInput } from '../shared/types.js';
import { PtyProtocolSessionTransport, type ProtocolSessionTransport } from './protocol-session-transport.js';
import { HttpSseProtocolSessionTransport } from './protocol-http-transport.js';
import type { ModelConfig } from '../shared/types.js';
import type { ProtocolConnectivityCheckInput, ProtocolConnectivityCheckResult } from '../shared/types.js';

let nanoid: (size?: number) => string;
const agentStateEngine = new AgentStateEngine();
const protocolRunnerBridge = new ProtocolRunnerBridge();
const runnerSessionToTerminal = new Map<string, string>();
const terminalToRunnerSession = new Map<string, string>();
const runnerTransportBySession = new Map<string, ProtocolSessionTransport>();
const sidechannelTokenByTerminal = new Map<string, string>();
const sidechannelPendingByTerminal = new Map<string, unknown[]>();
const SIDECAR_EVENT_PATH = '/v1/runner/event';
const SIDECAR_MAX_QUEUE_PER_TERMINAL = 128;
const SIDECAR_MAX_BODY_BYTES = 128 * 1024;
let sidechannelServer: http.Server | null = null;
let sidechannelPort: number | null = null;
let sidechannelStarting: Promise<void> | null = null;

async function ensureNanoid() {
  if (!nanoid) {
    const mod = await import('nanoid');
    nanoid = mod.nanoid;
  }
}

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
  ipcMain.handle(IPC.TERMINAL_SPAWN, async (_event, configId: string) => {
    await ensureNanoid();
    const config = configStore.getConfigById(configId);
    if (!config) {
      throw new Error(`Config not found: ${configId}`);
    }

    const terminalId = nanoid(12);
    const env = buildEnvForConfig(config);
    await ensureCodexApiKeyLogin(config, env);
    await injectRunnerSidechannelEnv(terminalId, env);
    agentStateEngine.registerTerminal(terminalId, config.provider, resolveWaitingDetectionMode(config));

    spawnPty(
      terminalId,
      env,
      (data: string) => {
        const displayData = agentStateEngine.onOutput(terminalId, data);
        ingestRunnerEventsFromTerminalOutput(terminalId, data);
        if (displayData) {
          notifyTerminalData(terminalId, displayData);
        }
      },
      (code: number) => {
        agentStateEngine.onExit(terminalId);
        cleanupRunnerSessionByTerminal(terminalId);
        cleanupTerminalSidechannelState(terminalId);
        notifyTerminalExit(terminalId, code);
      }
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
    cleanupRunnerSessionByTerminal(terminalId);
    cleanupTerminalSidechannelState(terminalId);
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
    protocolRunnerBridge.startSession(sessionId, config.provider);
    let transportType: 'pty' | 'http_sse' = 'pty';
    if (terminalId) {
      runnerSessionToTerminal.set(sessionId, terminalId);
      terminalToRunnerSession.set(terminalId, sessionId);
      flushPendingSidechannelEvents(terminalId, sessionId);
      const created = createSessionTransport(config, sessionId, terminalId);
      const transport = created.transport;
      transportType = created.transportType;
      runnerTransportBySession.set(sessionId, transport);
      if (transport.start) {
        transport.start((rawEvent: unknown) => {
          processTransportRawEvent(sessionId, rawEvent);
        });
      }
    }
    return {
      sessionId,
      provider: config.provider,
      linkedTerminalId: terminalId,
      transportType,
    };
  });

  ipcMain.handle(IPC.RUNNER_EVENT_INGEST, (_event, sessionId: string, rawEvent: unknown) => {
    const events = protocolRunnerBridge.ingestRawEvent(sessionId, rawEvent);
    dispatchRunnerEvents(sessionId, events);
  });

  ipcMain.handle(IPC.RUNNER_INPUT_RESOLVE, (_event, sessionId: string, requestId: string) => {
    return protocolRunnerBridge.resolveInput(sessionId, requestId);
  });

  ipcMain.handle(IPC.RUNNER_INPUT_SUBMIT, (_event, input: RunnerUserInput) => {
    const accepted = protocolRunnerBridge.resolveInput(input.sessionId, input.requestId);
    if (!accepted) return false;

    const transport = runnerTransportBySession.get(input.sessionId);
    if (transport) {
      transport.submitInput(input);
    }

    const provider = protocolRunnerBridge.getSessionProvider(input.sessionId) ?? 'codex';
    notifyRunnerEvent({
      id: `runner-local-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
      ts: Date.now(),
      provider,
      sessionId: input.sessionId,
      type: 'status.changed',
      from: 'awaiting_input',
      to: 'streaming',
      reason: input.type,
    });
    return true;
  });

  ipcMain.handle(IPC.RUNNER_SESSION_INTERRUPT, (_event, sessionId: string) => {
    const transport = runnerTransportBySession.get(sessionId);
    if (!transport) return false;
    transport.interrupt();
    return true;
  });

  ipcMain.handle(IPC.RUNNER_SESSION_STOP, (_event, sessionId: string) => {
    const transport = runnerTransportBySession.get(sessionId);
    if (!transport) return false;
    transport.stop();
    return true;
  });

  ipcMain.handle(IPC.RUNNER_SESSION_END, (_event, sessionId: string) => {
    protocolRunnerBridge.endSession(sessionId);
    cleanupRunnerSessionById(sessionId);
  });

  ipcMain.handle(IPC.RUNNER_METRICS_GET, () => {
    return protocolRunnerBridge.getMetricsSnapshot();
  });

  ipcMain.handle(IPC.RUNNER_METRICS_RESET, () => {
    protocolRunnerBridge.resetMetrics();
  });

  ipcMain.handle(IPC.RUNNER_CONNECTIVITY_TEST, async (_event, input: ProtocolConnectivityCheckInput) => {
    return await runProtocolConnectivityTest(input);
  });

  // System terminal
  ipcMain.handle(IPC.SYSTEM_TERMINAL_OPEN, async (_event, configId: string) => {
    const config = configStore.getConfigById(configId);
    if (!config) {
      throw new Error(`Config not found: ${configId}`);
    }
    await openSystemTerminal(config);
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
}

function notifyConfigChanged(): void {
  const wins = BrowserWindow.getAllWindows();
  for (const win of wins) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.CONFIG_CHANGED);
    }
  }
}

function notifyRunnerEvent(event: unknown): void {
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

function dispatchRunnerEvents(sessionId: string, events: Array<any>): void {
  for (const event of events) {
    notifyRunnerEvent(event);
    if (event.type === 'session.completed' || event.type === 'session.failed') {
      protocolRunnerBridge.endSession(sessionId);
      cleanupRunnerSessionById(sessionId);
    }
  }
}

function ingestRunnerEventsFromTerminalOutput(terminalId: string, chunk: string): void {
  const sessionId = terminalToRunnerSession.get(terminalId);
  if (!sessionId || !chunk) return;

  const transport = runnerTransportBySession.get(sessionId);
  if (!transport) return;

  const rawEvents = transport.ingestChunk(chunk);
  for (const rawEvent of rawEvents) {
    processTransportRawEvent(sessionId, rawEvent);
  }
}

function cleanupRunnerSessionByTerminal(terminalId: string): void {
  const sessionId = terminalToRunnerSession.get(terminalId);
  if (!sessionId) return;
  cleanupRunnerSessionById(sessionId);
  protocolRunnerBridge.endSession(sessionId);
}

function cleanupRunnerSessionById(sessionId: string): void {
  const terminalId = runnerSessionToTerminal.get(sessionId);
  if (terminalId) {
    terminalToRunnerSession.delete(terminalId);
  }
  runnerSessionToTerminal.delete(sessionId);
  runnerTransportBySession.delete(sessionId);
}

async function injectRunnerSidechannelEnv(terminalId: string, env: Record<string, string>): Promise<void> {
  try {
    await ensureRunnerSidechannelServer();
  } catch (err) {
    console.warn('Failed to start runner sidechannel server:', err);
    return;
  }
  if (!sidechannelPort) return;
  const token = randomBytes(24).toString('hex');
  sidechannelTokenByTerminal.set(terminalId, token);
  env.MC_RUNNER_EVENT_URL = `http://127.0.0.1:${sidechannelPort}${SIDECAR_EVENT_PATH}`;
  env.MC_RUNNER_EVENT_TOKEN = token;
  env.MC_RUNNER_TERMINAL_ID = terminalId;
}

async function ensureRunnerSidechannelServer(): Promise<void> {
  if (sidechannelServer && sidechannelPort) return;
  if (sidechannelStarting) return sidechannelStarting;

  sidechannelStarting = new Promise<void>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      void handleRunnerSidechannelRequest(req, res);
    });
    server.once('error', (err) => {
      reject(err);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Invalid sidechannel server address'));
        return;
      }
      sidechannelServer = server;
      sidechannelPort = addr.port;
      resolve();
    });
  });

  try {
    await sidechannelStarting;
  } finally {
    sidechannelStarting = null;
  }
}

async function handleRunnerSidechannelRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse<http.IncomingMessage>
): Promise<void> {
  if ((req.method || 'GET').toUpperCase() !== 'POST') {
    res.writeHead(405);
    res.end('method_not_allowed');
    return;
  }

  const reqUrl = req.url || '/';
  const path = reqUrl.split('?')[0];
  if (path !== SIDECAR_EVENT_PATH) {
    res.writeHead(404);
    res.end('not_found');
    return;
  }

  let rawBody = '';
  let bytes = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += buf.length;
    if (bytes > SIDECAR_MAX_BODY_BYTES) {
      res.writeHead(413);
      res.end('payload_too_large');
      return;
    }
    rawBody += buf.toString('utf8');
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      res.writeHead(400);
      res.end('invalid_payload');
      return;
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    res.writeHead(400);
    res.end('invalid_json');
    return;
  }

  const terminalId = readString(payload.terminalId) || readString(payload.termId) || readString(payload.tid);
  if (!terminalId) {
    res.writeHead(400);
    res.end('missing_terminal_id');
    return;
  }

  const expectedToken = sidechannelTokenByTerminal.get(terminalId);
  if (!expectedToken) {
    res.writeHead(404);
    res.end('terminal_not_found');
    return;
  }
  const providedToken = readSidechannelToken(req);
  if (!providedToken || providedToken !== expectedToken) {
    res.writeHead(401);
    res.end('unauthorized');
    return;
  }

  const normalized = normalizeSidechannelPayload(payload, terminalId);
  if (!normalized) {
    res.writeHead(400);
    res.end('missing_event');
    return;
  }

  const sessionId = terminalToRunnerSession.get(terminalId);
  if (sessionId) {
    processTransportRawEvent(sessionId, normalized);
  } else {
    queuePendingSidechannelEvent(terminalId, normalized);
  }

  res.writeHead(202);
  res.end('accepted');
}

function readSidechannelToken(req: http.IncomingMessage): string | null {
  const tokenHeader = req.headers['x-mc-runner-token'];
  const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
  if (typeof token === 'string' && token.trim()) {
    return token.trim();
  }
  const authHeader = req.headers.authorization;
  const auth = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (typeof auth === 'string') {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match && match[1]) return match[1].trim();
  }
  return null;
}

function normalizeSidechannelPayload(payload: Record<string, unknown>, terminalId: string): unknown {
  const rawEvent = payload.rawEvent;
  if (rawEvent !== undefined) {
    return rawEvent;
  }

  const marker = payload.runnerEvent;
  if (marker && typeof marker === 'object' && !Array.isArray(marker)) {
    return { __mc_runner_event: marker };
  }

  const event = payload.event;
  if (event && typeof event === 'object' && !Array.isArray(event)) {
    return event;
  }

  const state = readString(payload.state)?.toLowerCase();
  if (!state) return null;
  const now = Date.now();
  if (state === 'waiting') {
    const inputKind = readString(payload.inputKind) === 'text' ? 'text' : 'approval';
    const requestId = readString(payload.requestId) || `side-wait-${terminalId}-${now}`;
    const prompt = readString(payload.prompt) || 'User interaction required';
    return {
      __mc_runner_event: {
        type: 'input.requested',
        inputKind,
        requestId,
        prompt,
        source: 'sidechannel',
      },
    };
  }
  if (state === 'running') {
    return {
      __mc_runner_event: {
        type: 'status.changed',
        from: 'awaiting_input',
        to: 'streaming',
        reason: 'sidechannel-running',
        source: 'sidechannel',
      },
    };
  }
  return {
    __mc_runner_event: {
      type: 'status.changed',
      from: 'streaming',
      to: state,
      reason: 'sidechannel-state',
      source: 'sidechannel',
    },
  };
}

function queuePendingSidechannelEvent(terminalId: string, event: unknown): void {
  const pending = sidechannelPendingByTerminal.get(terminalId) ?? [];
  pending.push(event);
  if (pending.length > SIDECAR_MAX_QUEUE_PER_TERMINAL) {
    pending.splice(0, pending.length - SIDECAR_MAX_QUEUE_PER_TERMINAL);
  }
  sidechannelPendingByTerminal.set(terminalId, pending);
}

function flushPendingSidechannelEvents(terminalId: string, sessionId: string): void {
  const pending = sidechannelPendingByTerminal.get(terminalId);
  if (!pending || pending.length === 0) return;
  sidechannelPendingByTerminal.delete(terminalId);
  for (const event of pending) {
    processTransportRawEvent(sessionId, event);
  }
}

function cleanupTerminalSidechannelState(terminalId: string): void {
  sidechannelTokenByTerminal.delete(terminalId);
  sidechannelPendingByTerminal.delete(terminalId);
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function createSessionTransport(
  config: ModelConfig,
  sessionId: string,
  terminalId: string
): { transport: ProtocolSessionTransport; transportType: 'pty' | 'http_sse' } {
  const transportType = (config.customEnvVars['MC_PROTOCOL_TRANSPORT'] || '').trim().toLowerCase();
  if (transportType === 'http_sse') {
    const inferred = inferHttpSseDefaults(config);
    const streamUrl = (config.customEnvVars['MC_PROTOCOL_STREAM_URL'] || '').trim() || inferred.streamUrl;
    const inputUrl = (config.customEnvVars['MC_PROTOCOL_INPUT_URL'] || '').trim() || inferred.inputUrl;
    const interruptUrl = (config.customEnvVars['MC_PROTOCOL_INTERRUPT_URL'] || '').trim() || inferred.interruptUrl;
    const stopUrl = (config.customEnvVars['MC_PROTOCOL_STOP_URL'] || '').trim() || inferred.stopUrl;
    if (inputUrl) {
      const headers: Record<string, string> = { ...inferred.headers };
      const authHeader = (config.customEnvVars['MC_PROTOCOL_AUTH_HEADER'] || '').trim();
      const authToken = (config.customEnvVars['MC_PROTOCOL_AUTH_TOKEN'] || '').trim();
      if (authHeader && authToken) {
        headers[authHeader] = authToken;
      }
      const rawHeaderJson = (config.customEnvVars['MC_PROTOCOL_HEADERS_JSON'] || '').trim();
      if (rawHeaderJson) {
        try {
          const parsed = JSON.parse(rawHeaderJson);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            for (const [key, value] of Object.entries(parsed)) {
              if (typeof key === 'string' && typeof value === 'string') {
                headers[key] = value;
              }
            }
          }
        } catch {
          // Ignore malformed header JSON and continue with inferred headers.
        }
      }
      return {
        transport: new HttpSseProtocolSessionTransport({
          sessionId,
          streamUrl,
          inputUrl,
          interruptUrl: interruptUrl || undefined,
          stopUrl: stopUrl || undefined,
          headers,
          reconnectMax: parsePositiveInt(config.customEnvVars['MC_PROTOCOL_RECONNECT_MAX']),
          reconnectBaseMs: parsePositiveInt(config.customEnvVars['MC_PROTOCOL_RECONNECT_BASE_MS']),
        }),
        transportType: 'http_sse',
      };
    }
  }

  return {
    transport: new PtyProtocolSessionTransport({
      write: (data: string) => writePty(terminalId, data),
      kill: () => killPty(terminalId),
    }),
    transportType: 'pty',
  };
}

function inferHttpSseDefaults(config: ModelConfig): {
  streamUrl?: string;
  inputUrl: string;
  interruptUrl?: string;
  stopUrl?: string;
  headers: Record<string, string>;
} {
  if (config.provider === 'claude') {
    const baseUrl = trimTrailingSlash(config.anthropicBaseUrl || 'https://api.anthropic.com');
    const token = (config.anthropicAuthToken || '').trim();
    const headers: Record<string, string> = {
      'anthropic-version': '2023-06-01',
    };
    if (token) {
      headers['x-api-key'] = token;
    }
    return {
      streamUrl: `${baseUrl}/v1/messages/stream`,
      inputUrl: `${baseUrl}/v1/messages/input`,
      interruptUrl: `${baseUrl}/v1/messages/interrupt`,
      stopUrl: `${baseUrl}/v1/messages/stop`,
      headers,
    };
  }

  const baseUrl = trimTrailingSlash(config.openaiBaseUrl || 'https://api.openai.com');
  const token = (config.openaiApiKey || '').trim();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return {
    streamUrl: `${baseUrl}/v1/responses/stream`,
    inputUrl: `${baseUrl}/v1/responses/input`,
    interruptUrl: `${baseUrl}/v1/responses/interrupt`,
    stopUrl: `${baseUrl}/v1/responses/cancel`,
    headers,
  };
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function resolveWaitingDetectionMode(config: ModelConfig): 'heuristic' | 'strict' {
  const mode = (config.customEnvVars['MC_WAITING_DETECTION_MODE'] || '').trim().toLowerCase();
  if (mode === 'heuristic' || mode === 'strict') {
    return mode;
  }
  // Protocol runner sessions should rely on structured events for accuracy.
  const protocolTransport = (config.customEnvVars['MC_PROTOCOL_TRANSPORT'] || '').trim();
  if (protocolTransport) {
    return 'strict';
  }
  return 'heuristic';
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function processTransportRawEvent(sessionId: string, rawEvent: unknown): void {
  const marker = asRunnerEventMarker(rawEvent);
  if (marker) {
    notifyRunnerEvent(enrichLocalRunnerEvent(sessionId, marker));
    return;
  }
  const events = protocolRunnerBridge.ingestRawEvent(sessionId, rawEvent);
  dispatchRunnerEvents(sessionId, events);
}

function asRunnerEventMarker(rawEvent: unknown): Record<string, unknown> | null {
  if (!rawEvent || typeof rawEvent !== 'object') return null;
  const container = rawEvent as Record<string, unknown>;
  const event = container.__mc_runner_event;
  if (!event || typeof event !== 'object') return null;
  return event as Record<string, unknown>;
}

function enrichLocalRunnerEvent(sessionId: string, partial: Record<string, unknown>): Record<string, unknown> {
  const provider = protocolRunnerBridge.getSessionProvider(sessionId) ?? 'codex';
  return {
    id: `runner-local-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
    ts: Date.now(),
    provider,
    sessionId,
    ...partial,
  };
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

function inferHttpSseDefaultsFromInput(input: ProtocolConnectivityCheckInput): {
  streamUrl?: string;
  inputUrl: string;
  interruptUrl?: string;
  stopUrl?: string;
  headers: Record<string, string>;
} {
  if (input.provider === 'claude') {
    const baseUrl = trimTrailingSlash(input.anthropicBaseUrl || 'https://api.anthropic.com');
    const token = (input.anthropicAuthToken || '').trim();
    const headers: Record<string, string> = {
      'anthropic-version': '2023-06-01',
    };
    if (token) {
      headers['x-api-key'] = token;
    }
    return {
      streamUrl: `${baseUrl}/v1/messages/stream`,
      inputUrl: `${baseUrl}/v1/messages/input`,
      interruptUrl: `${baseUrl}/v1/messages/interrupt`,
      stopUrl: `${baseUrl}/v1/messages/stop`,
      headers,
    };
  }

  const baseUrl = trimTrailingSlash(input.openaiBaseUrl || 'https://api.openai.com');
  const token = (input.openaiApiKey || '').trim();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return {
    streamUrl: `${baseUrl}/v1/responses/stream`,
    inputUrl: `${baseUrl}/v1/responses/input`,
    interruptUrl: `${baseUrl}/v1/responses/interrupt`,
    stopUrl: `${baseUrl}/v1/responses/cancel`,
    headers,
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
