import type { RunnerUserInput } from '../shared/types.js';

export interface ProtocolSessionTransport {
  start?(onRawEvent: (rawEvent: unknown) => void): void;
  ingestChunk(chunk: string): unknown[];
  submitInput(input: RunnerUserInput): void;
  interrupt(): void;
  stop(): void;
}

interface PtyTransportOptions {
  write: (data: string) => void;
  kill: () => void;
}

/**
 * PTY-backed transport for v1.
 * Future HTTP/SSE transports can implement the same interface without changing IPC/UI.
 */
export class PtyProtocolSessionTransport implements ProtocolSessionTransport {
  private lineBuffer = '';
  private write: (data: string) => void;
  private kill: () => void;

  constructor(options: PtyTransportOptions) {
    this.write = options.write;
    this.kill = options.kill;
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
        // Ignore non-JSON lines.
      }
    }
    return events;
  }

  submitInput(input: RunnerUserInput): void {
    this.write(toTerminalInput(input));
  }

  interrupt(): void {
    // Ctrl+C
    this.write('\x03');
  }

  stop(): void {
    this.kill();
  }
}

function toTerminalInput(input: RunnerUserInput): string {
  if (input.type === 'user_response') {
    return `${input.text ?? ''}\r`;
  }
  if (input.type === 'user_approve') {
    return 'y\r';
  }
  if (input.type === 'user_reject') {
    return 'n\r';
  }
  return '\r';
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
