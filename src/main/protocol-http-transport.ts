import type { RunnerUserInput } from '../shared/types.js';
import type { ProtocolSessionTransport } from './protocol-session-transport.js';

interface HttpSseTransportOptions {
  sessionId: string;
  streamUrl?: string;
  inputUrl: string;
  interruptUrl?: string;
  stopUrl?: string;
  headers?: Record<string, string>;
  reconnectMax?: number;
  reconnectBaseMs?: number;
}

/**
 * HTTP/SSE-oriented transport.
 * It parses json lines from streamed text chunks and sends user actions by HTTP.
 */
export class HttpSseProtocolSessionTransport implements ProtocolSessionTransport {
  private sessionId: string;
  private inputUrl: string;
  private interruptUrl?: string;
  private stopUrl?: string;
  private headers: Record<string, string>;
  private streamUrl?: string;
  private streamAbortController: AbortController | null = null;
  private manualStop = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectMax: number;
  private reconnectBaseMs: number;
  private lineBuffer = '';

  constructor(options: HttpSseTransportOptions) {
    this.sessionId = options.sessionId;
    this.streamUrl = options.streamUrl;
    this.inputUrl = options.inputUrl;
    this.interruptUrl = options.interruptUrl;
    this.stopUrl = options.stopUrl;
    this.headers = options.headers ?? {};
    this.reconnectMax = Math.max(0, options.reconnectMax ?? 6);
    this.reconnectBaseMs = Math.max(100, options.reconnectBaseMs ?? 500);
  }

  start(onRawEvent: (rawEvent: unknown) => void): void {
    const streamUrl = this.resolveStreamUrl();
    if (!streamUrl) return;
    if (this.streamAbortController) return;
    this.manualStop = false;
    this.reconnectAttempt = 0;
    onRawEvent({
      __mc_runner_event: {
        type: 'status.changed',
        from: 'starting',
        to: 'starting',
        reason: 'http_sse_connecting',
      },
    });
    this.startStream(streamUrl, onRawEvent);
  }

  ingestChunk(chunk: string): unknown[] {
    if (!chunk) return [];

    const merged = this.lineBuffer + chunk;
    const lines = merged.split(/\r?\n/);
    this.lineBuffer = lines.pop() ?? '';

    const events: unknown[] = [];
    for (const rawLine of lines) {
      const line = stripAnsi(rawLine).trim();
      if (!line) continue;
      const payload = extractJsonPayload(line);
      if (!payload) continue;
      try {
        events.push(JSON.parse(payload));
      } catch {
        // ignore malformed line
      }
    }
    return events;
  }

  submitInput(input: RunnerUserInput): void {
    void this.postJson(this.inputUrl, {
      sessionId: this.sessionId,
      requestId: input.requestId,
      type: input.type,
      text: input.text,
    });
  }

  interrupt(): void {
    if (!this.interruptUrl) return;
    void this.postJson(this.interruptUrl, { sessionId: this.sessionId });
  }

  stop(): void {
    this.manualStop = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.streamAbortController) {
      this.streamAbortController.abort();
      this.streamAbortController = null;
    }
    if (!this.stopUrl) return;
    void this.postJson(this.stopUrl, { sessionId: this.sessionId });
  }

  private async postJson(url: string, body: Record<string, unknown>): Promise<void> {
    await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify(body),
    });
  }

  private resolveStreamUrl(): string | undefined {
    return this.streamUrl;
  }

  private async consumeSseStream(
    url: string,
    signal: AbortSignal,
    onRawEvent: (rawEvent: unknown) => void
  ): Promise<void> {
    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers,
      signal,
    });
    if (!response.ok) {
      const message = `SSE stream HTTP ${response.status}`;
      if (shouldRetryStatus(response.status)) {
        throw new Error(message);
      }
      onRawEvent({
        type: 'error',
        error: { message, code: `HTTP_${response.status}` },
      });
      return;
    }
    if (!response.body) {
      throw new Error('SSE stream has no response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          throw new Error('SSE stream closed');
        }
        const chunk = decoder.decode(value, { stream: true });
        const rawEvents = this.ingestChunk(chunk);
        for (const rawEvent of rawEvents) {
          this.reconnectAttempt = 0;
          onRawEvent(rawEvent);
        }
      }
    } finally {
      reader.releaseLock();
      if (this.streamAbortController?.signal === signal) {
        this.streamAbortController = null;
      }
    }
  }

  private startStream(url: string, onRawEvent: (rawEvent: unknown) => void): void {
    if (this.manualStop) return;
    const controller = new AbortController();
    this.streamAbortController = controller;

    void this.consumeSseStream(url, controller.signal, onRawEvent)
      .then(() => {
        this.reconnectAttempt = 0;
      })
      .catch((err) => {
        if (this.manualStop || controller.signal.aborted) return;
        this.scheduleReconnect(url, onRawEvent);
      });
  }

  private scheduleReconnect(url: string, onRawEvent: (rawEvent: unknown) => void): void {
    if (this.manualStop) return;
    if (this.reconnectAttempt >= this.reconnectMax) {
      onRawEvent({
        type: 'error',
        error: {
          message: 'SSE reconnect attempts exhausted',
          code: 'STREAM_RECONNECT_EXHAUSTED',
        },
      });
      return;
    }
    this.reconnectAttempt += 1;
    const delayMs = Math.min(this.reconnectBaseMs * (2 ** (this.reconnectAttempt - 1)), 10_000);
    onRawEvent({
      __mc_runner_event: {
        type: 'status.changed',
        from: 'streaming',
        to: 'starting',
        reason: `http_sse_reconnecting_${this.reconnectAttempt}_in_${delayMs}ms`,
      },
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.startStream(url, onRawEvent);
    }, delayMs);
    if (typeof (this.reconnectTimer as any).unref === 'function') {
      (this.reconnectTimer as any).unref();
    }
  }
}

function shouldRetryStatus(status: number): boolean {
  if (status >= 500) return true;
  return status === 408 || status === 409 || status === 425 || status === 429;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function extractJsonPayload(line: string): string | null {
  if (line.startsWith('data:')) {
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return null;
    return payload.startsWith('{') && payload.endsWith('}') ? payload : null;
  }
  if (line.startsWith('{') && line.endsWith('}')) {
    return line;
  }
  return null;
}
