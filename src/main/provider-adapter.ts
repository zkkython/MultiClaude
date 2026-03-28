export type RunnerProvider = 'claude' | 'codex';

export type RunnerEventType =
  | 'session.started'
  | 'output.delta'
  | 'output.completed'
  | 'input.requested'
  | 'status.changed'
  | 'session.completed'
  | 'session.failed';

export type InputKind = 'text' | 'approval';

export type SessionFailedCode =
  | 'SPAWN_ERROR'
  | 'PROTOCOL_PARSE_ERROR'
  | 'PROTOCOL_TIMEOUT'
  | 'PROCESS_EXIT_NONZERO'
  | 'UNKNOWN';

export interface RunnerEventBase {
  id: string;
  ts: number;
  provider: RunnerProvider;
  sessionId: string;
  type: RunnerEventType;
}

export interface SessionStartedEvent extends RunnerEventBase {
  type: 'session.started';
}

export interface OutputDeltaEvent extends RunnerEventBase {
  type: 'output.delta';
  channel: 'stdout' | 'stderr';
  text: string;
}

export interface OutputCompletedEvent extends RunnerEventBase {
  type: 'output.completed';
}

export interface InputRequestedEvent extends RunnerEventBase {
  type: 'input.requested';
  inputKind: InputKind;
  prompt: string;
  requestId: string;
}

export interface StatusChangedEvent extends RunnerEventBase {
  type: 'status.changed';
  from: string;
  to: string;
  reason: string;
}

export interface SessionCompletedEvent extends RunnerEventBase {
  type: 'session.completed';
  reason?: string;
}

export interface SessionFailedEvent extends RunnerEventBase {
  type: 'session.failed';
  code: SessionFailedCode;
  message: string;
  recoverable: boolean;
}

export type RunnerEvent =
  | SessionStartedEvent
  | OutputDeltaEvent
  | OutputCompletedEvent
  | InputRequestedEvent
  | StatusChangedEvent
  | SessionCompletedEvent
  | SessionFailedEvent;

export interface NormalizeContext {
  sessionId: string;
  now?: number;
}

export interface NormalizeResult {
  events: RunnerEvent[];
}

export interface ProviderAdapter {
  readonly provider: RunnerProvider;
  normalizeEvent(rawEvent: unknown, context: NormalizeContext): NormalizeResult;
  resolvePendingInput(sessionId: string, requestId: string): boolean;
  resetSession(sessionId: string): void;
}

interface AdapterSessionState {
  seenRequestIds: Set<string>;
  pendingRequestId: string | null;
  started: boolean;
}

let globalEventSeq = 0;

export function createProviderAdapter(provider: RunnerProvider): ProviderAdapter {
  if (provider === 'claude') return new ClaudeProviderAdapter();
  return new CodexProviderAdapter();
}

export class ClaudeProviderAdapter implements ProviderAdapter {
  readonly provider: RunnerProvider = 'claude';
  private sessions = new Map<string, AdapterSessionState>();

  normalizeEvent(rawEvent: unknown, context: NormalizeContext): NormalizeResult {
    const now = context.now ?? Date.now();
    const event = toRecord(rawEvent);
    const type = stringValue(event.type);
    if (!type) {
      return {
        events: [
          makeFailedEvent(this.provider, context.sessionId, now, 'PROTOCOL_PARSE_ERROR', 'Claude event missing type', true),
        ],
      };
    }

    switch (type) {
      case 'message_start':
        return this.applyGuards(context.sessionId, {
          events: [makeBaseEvent('session.started', this.provider, context.sessionId, now)],
        });

      case 'content_block_delta': {
        // Claude text delta: event.delta.type === 'text_delta' && event.delta.text
        const delta = toRecord(event.delta);
        const deltaType = stringValue(delta.type);
        const text = stringValue(delta.text) ?? stringValue(event.text);
        if (deltaType === 'text_delta' && text) {
          return this.applyGuards(context.sessionId, {
            events: [
              {
                ...makeBaseEvent('output.delta', this.provider, context.sessionId, now),
                channel: 'stdout',
                text,
              },
            ],
          });
        }
        return { events: [] };
      }

      case 'content_block_start': {
        // Some Claude streams surface tool-use at block start rather than message_stop.
        const contentBlock = toRecord(event.content_block);
        if (stringValue(contentBlock.type) !== 'tool_use') {
          return { events: [] };
        }
        const requestId = stringValue(contentBlock.id)
          ?? stringValue(contentBlock.tool_use_id)
          ?? makeRequestId('claude-tool', context.sessionId, now);
        const toolName = stringValue(contentBlock.name);
        return this.applyGuards(context.sessionId, {
          events: [
            {
              ...makeBaseEvent('input.requested', this.provider, context.sessionId, now),
              inputKind: 'approval',
              prompt: makeToolPrompt('Claude', toolName),
              requestId,
            },
          ],
        });
      }

      case 'content_block_stop':
      case 'message_delta':
        return this.applyGuards(context.sessionId, {
          events: [makeBaseEvent('output.completed', this.provider, context.sessionId, now)],
        });

      case 'message_stop': {
        // Claude stop_reason is the key branch for completed vs needs-input.
        const stopReason = stringValue(event.stop_reason) ?? stringValue(toRecord(event.delta).stop_reason);
        if (stopReason === 'end_turn') {
          return this.applyGuards(context.sessionId, {
            events: [
              {
                ...makeBaseEvent('session.completed', this.provider, context.sessionId, now),
                reason: 'end_turn',
              },
            ],
          });
        }
        if (stopReason === 'tool_use') {
          const toolUse = toRecord(event.tool_use);
          const requestId = stringValue(event.tool_use_id)
            ?? stringValue(event.request_id)
            ?? stringValue(toolUse.id)
            ?? makeRequestId('claude-tool', context.sessionId, now);
          const toolName = stringValue(toolUse.name);
          return this.applyGuards(context.sessionId, {
            events: [
              {
                ...makeBaseEvent('input.requested', this.provider, context.sessionId, now),
                inputKind: 'approval',
                prompt: makeToolPrompt('Claude', toolName),
                requestId,
              },
            ],
          });
        }
        return { events: [] };
      }

      case 'error': {
        const err = toRecord(event.error);
        const message = stringValue(err.message) ?? 'Claude provider error';
        const rawCode = stringValue(err.code);
        const failedCode = mapFailedCode(rawCode, message);
        const recoverable = isRecoverableError(rawCode, message);
        return this.applyGuards(context.sessionId, {
          events: [makeFailedEvent(this.provider, context.sessionId, now, failedCode, message, recoverable)],
        });
      }

      default:
        return { events: [] };
    }
  }

  resolvePendingInput(sessionId: string, requestId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.pendingRequestId) return false;
    if (session.pendingRequestId !== requestId) return false;
    session.pendingRequestId = null;
    return true;
  }

  resetSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private getSessionState(sessionId: string): AdapterSessionState {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const created: AdapterSessionState = {
      seenRequestIds: new Set<string>(),
      pendingRequestId: null,
      started: false,
    };
    this.sessions.set(sessionId, created);
    return created;
  }

  private applyGuards(sessionId: string, result: NormalizeResult): NormalizeResult {
    return applySessionGuards(this.provider, sessionId, this.getSessionState(sessionId), result);
  }
}

export class CodexProviderAdapter implements ProviderAdapter {
  readonly provider: RunnerProvider = 'codex';
  private sessions = new Map<string, AdapterSessionState>();

  normalizeEvent(rawEvent: unknown, context: NormalizeContext): NormalizeResult {
    const now = context.now ?? Date.now();
    const event = toRecord(rawEvent);
    const type = stringValue(event.type);
    if (!type) {
      return {
        events: [
          makeFailedEvent(this.provider, context.sessionId, now, 'PROTOCOL_PARSE_ERROR', 'Codex event missing type', true),
        ],
      };
    }

    switch (type) {
      case 'response.created':
      case 'run.created':
        return this.applyGuards(context.sessionId, {
          events: [makeBaseEvent('session.started', this.provider, context.sessionId, now)],
        });

      case 'response.output_text.delta': {
        const item = toRecord(event.item);
        const text = stringValue(event.delta)
          ?? stringValue(item.delta)
          ?? stringValue(toRecord(item.text).value);
        if (!text) return { events: [] };
        return this.applyGuards(context.sessionId, {
          events: [
            {
              ...makeBaseEvent('output.delta', this.provider, context.sessionId, now),
              channel: 'stdout',
              text,
            },
          ],
        });
      }

      case 'response.output_item.done':
        return this.applyGuards(context.sessionId, {
          events: [makeBaseEvent('output.completed', this.provider, context.sessionId, now)],
        });

      case 'response.completed':
      case 'run.completed':
        return this.applyGuards(context.sessionId, {
          events: [
            {
              ...makeBaseEvent('session.completed', this.provider, context.sessionId, now),
              reason: 'completed',
            },
          ],
        });

      case 'response.output_item.added':
      case 'run.requires_action': {
        // Tool-use style events are mapped as user interaction requests.
        const item = toRecord(event.item);
        const requiredAction = toRecord(event.required_action);
        const submitToolOutputs = toRecord(requiredAction.submit_tool_outputs);
        const firstToolCall = firstRecordValue(toRecordArray(submitToolOutputs.tool_calls));

        const requestId = stringValue(event.call_id)
          ?? stringValue(event.tool_call_id)
          ?? stringValue(item.id)
          ?? stringValue(firstToolCall?.id)
          ?? makeRequestId('codex-tool', context.sessionId, now);
        const toolName = stringValue(item.name) ?? stringValue(firstToolCall?.function?.name);

        return this.applyGuards(context.sessionId, {
          events: [
            {
              ...makeBaseEvent('input.requested', this.provider, context.sessionId, now),
              inputKind: 'approval',
              prompt: makeToolPrompt('Codex', toolName),
              requestId,
            },
          ],
        });
      }

      case 'response.failed':
      case 'run.failed': {
        const error = toRecord(event.error);
        const message = stringValue(error.message) ?? 'Codex provider error';
        const rawCode = stringValue(error.code);
        const failedCode = mapFailedCode(rawCode, message);
        const recoverable = isRecoverableError(rawCode, message);
        return this.applyGuards(context.sessionId, {
          events: [makeFailedEvent(this.provider, context.sessionId, now, failedCode, message, recoverable)],
        });
      }

      default:
        return { events: [] };
    }
  }

  resolvePendingInput(sessionId: string, requestId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.pendingRequestId) return false;
    if (session.pendingRequestId !== requestId) return false;
    session.pendingRequestId = null;
    return true;
  }

  resetSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private getSessionState(sessionId: string): AdapterSessionState {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const created: AdapterSessionState = {
      seenRequestIds: new Set<string>(),
      pendingRequestId: null,
      started: false,
    };
    this.sessions.set(sessionId, created);
    return created;
  }

  private applyGuards(sessionId: string, result: NormalizeResult): NormalizeResult {
    return applySessionGuards(this.provider, sessionId, this.getSessionState(sessionId), result);
  }
}

function applySessionGuards(
  provider: RunnerProvider,
  sessionId: string,
  session: AdapterSessionState,
  result: NormalizeResult
): NormalizeResult {
  const out: RunnerEvent[] = [];

  for (const event of result.events) {
    if (event.type === 'session.started') {
      session.started = true;
      out.push(event);
      continue;
    }

    if (event.type === 'input.requested') {
      if (session.seenRequestIds.has(event.requestId)) {
        continue;
      }
      if (session.pendingRequestId && session.pendingRequestId !== event.requestId) {
        out.push(
          makeFailedEvent(
            provider,
            sessionId,
            event.ts,
            'PROTOCOL_PARSE_ERROR',
            'Multiple concurrent input requests are not supported in v1',
            true
          )
        );
        continue;
      }

      session.seenRequestIds.add(event.requestId);
      session.pendingRequestId = event.requestId;
      out.push(event);
      continue;
    }

    if (event.type === 'session.completed' || event.type === 'session.failed') {
      session.pendingRequestId = null;
      out.push(event);
      continue;
    }

    out.push(event);
  }

  return { events: out };
}

function makeBaseEvent<T extends RunnerEventType>(
  type: T,
  provider: RunnerProvider,
  sessionId: string,
  ts: number
): RunnerEventBase & { type: T } {
  globalEventSeq += 1;
  return {
    id: `${provider}-${sessionId}-${ts}-${globalEventSeq}`,
    ts,
    provider,
    sessionId,
    type,
  };
}

function makeFailedEvent(
  provider: RunnerProvider,
  sessionId: string,
  ts: number,
  code: SessionFailedCode,
  message: string,
  recoverable: boolean
): SessionFailedEvent {
  return {
    ...makeBaseEvent('session.failed', provider, sessionId, ts),
    code,
    message,
    recoverable,
  };
}

function makeRequestId(prefix: string, sessionId: string, ts: number): string {
  return `${prefix}-${sessionId}-${ts}-${Math.floor(Math.random() * 1_000_000)}`;
}

function makeToolPrompt(providerName: 'Claude' | 'Codex', toolName?: string): string {
  if (toolName) return `${providerName} requests tool action: ${toolName}.`;
  return `${providerName} requests a tool action.`;
}

function mapFailedCode(rawCode: string | undefined, message: string): SessionFailedCode {
  const merged = `${rawCode || ''} ${message}`.toLowerCase();
  if (merged.includes('timeout')) return 'PROTOCOL_TIMEOUT';
  if (merged.includes('parse') || merged.includes('invalid json')) return 'PROTOCOL_PARSE_ERROR';
  if (merged.includes('non-zero') || merged.includes('exit code') || merged.includes('process exit')) {
    return 'PROCESS_EXIT_NONZERO';
  }
  return 'UNKNOWN';
}

function isRecoverableError(rawCode: string | undefined, message: string): boolean {
  const merged = `${rawCode || ''} ${message}`.toLowerCase();
  if (merged.includes('401') || merged.includes('403') || merged.includes('unauthorized') || merged.includes('forbidden')) {
    return false;
  }
  return true;
}

function toRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, any>;
}

function toRecordArray(value: unknown): Array<Record<string, any>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, any> => Boolean(item) && typeof item === 'object');
}

function firstRecordValue(list: Array<Record<string, any>>): Record<string, any> | null {
  return list.length > 0 ? list[0] : null;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
