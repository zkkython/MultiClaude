import * as http from 'http';
import { randomBytes } from 'crypto';

const SIDECAR_EVENT_PATH = '/v1/runner/event';
const SIDECAR_MAX_BODY_BYTES = 128 * 1024;

export interface RunnerSidechannelGatewayDeps {
  ingestEvent: (terminalId: string, event: unknown) => void;
}

interface SidechannelServer {
  once: (event: 'error', listener: (err: Error) => void) => void;
  listen: (port: number, host: string, callback: () => void) => void;
  address: () => ReturnType<http.Server['address']>;
  close: (callback: () => void) => void;
}

interface RunnerSidechannelGatewayInternalDeps {
  createServer: (handler: http.RequestListener) => SidechannelServer;
  createToken: () => string;
}

const defaultInternalDeps: RunnerSidechannelGatewayInternalDeps = {
  createServer: (handler) => http.createServer(handler),
  createToken: () => randomBytes(24).toString('hex'),
};

export class RunnerSidechannelGateway {
  private tokenByTerminal = new Map<string, string>();
  private server: SidechannelServer | null = null;
  private port: number | null = null;
  private starting: Promise<void> | null = null;
  private internalDeps: RunnerSidechannelGatewayInternalDeps;

  constructor(
    private deps: RunnerSidechannelGatewayDeps,
    internalDeps?: Partial<RunnerSidechannelGatewayInternalDeps>
  ) {
    this.internalDeps = { ...defaultInternalDeps, ...(internalDeps || {}) };
  }

  async injectEnv(terminalId: string, env: Record<string, string>): Promise<void> {
    await this.ensureServer();
    if (!this.port) return;
    const token = this.internalDeps.createToken();
    this.tokenByTerminal.set(terminalId, token);
    env.MC_RUNNER_EVENT_URL = `http://127.0.0.1:${this.port}${SIDECAR_EVENT_PATH}`;
    env.MC_RUNNER_EVENT_TOKEN = token;
    env.MC_RUNNER_TERMINAL_ID = terminalId;
  }

  cleanupTerminal(terminalId: string): void {
    this.tokenByTerminal.delete(terminalId);
  }

  async close(): Promise<void> {
    this.tokenByTerminal.clear();
    const server = this.server;
    this.server = null;
    this.port = null;
    this.starting = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private async ensureServer(): Promise<void> {
    if (this.server && this.port) return;
    if (this.starting) return this.starting;

    this.starting = new Promise<void>((resolve, reject) => {
      const server = this.internalDeps.createServer((req, res) => {
        void this.handleRequest(req, res);
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
        this.server = server;
        this.port = addr.port;
        resolve();
      });
    });

    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse<http.IncomingMessage>
  ): Promise<void> {
    if ((req.method || 'GET').toUpperCase() !== 'POST') {
      res.writeHead(405);
      res.end('method_not_allowed');
      return;
    }

    const reqUrl = req.url || '/';
    const reqPath = reqUrl.split('?')[0];
    if (reqPath !== SIDECAR_EVENT_PATH) {
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

    const terminalId = readTerminalIdFromPayload(payload);
    if (!terminalId) {
      res.writeHead(400);
      res.end('missing_terminal_id');
      return;
    }

    const expectedToken = this.tokenByTerminal.get(terminalId);
    if (!expectedToken) {
      res.writeHead(404);
      res.end('terminal_not_found');
      return;
    }
    const providedToken = readSidechannelTokenFromHeaders(req.headers);
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

    this.deps.ingestEvent(terminalId, normalized);
    res.writeHead(202);
    res.end('accepted');
  }
}

export function readSidechannelTokenFromHeaders(headers: http.IncomingHttpHeaders): string | null {
  const tokenHeader = headers['x-mc-runner-token'];
  const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
  if (typeof token === 'string' && token.trim()) {
    return token.trim();
  }
  const authHeader = headers.authorization;
  const auth = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (typeof auth === 'string') {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match && match[1]) return match[1].trim();
  }
  return null;
}

export function readTerminalIdFromPayload(payload: Record<string, unknown>): string | null {
  return readString(payload.terminalId) || readString(payload.termId) || readString(payload.tid);
}

export function normalizeSidechannelPayload(payload: Record<string, unknown>, terminalId: string): unknown {
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
  const hookEventName = readHookEventName(payload);
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
        hookEventName,
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
        reason: hookEventName ? `sidechannel-running:${hookEventName}` : 'sidechannel-running',
        hookEventName,
        source: 'sidechannel',
      },
    };
  }
  return {
    __mc_runner_event: {
      type: 'status.changed',
      from: 'streaming',
      to: state,
      reason: hookEventName ? `sidechannel-state:${hookEventName}` : 'sidechannel-state',
      hookEventName,
      source: 'sidechannel',
    },
  };
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readHookEventName(payload: Record<string, unknown>): string | null {
  const direct = readString(payload.hookEventName);
  if (direct) return direct;
  const rawHook = payload.rawHookEvent;
  if (!rawHook || typeof rawHook !== 'object' || Array.isArray(rawHook)) return null;
  return readString((rawHook as Record<string, unknown>).hook_event_name);
}
