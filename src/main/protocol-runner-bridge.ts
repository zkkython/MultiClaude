import type { ConfigProvider } from '../shared/types.js';
import {
  createProviderAdapter,
  type ProviderAdapter,
  type RunnerEvent,
  type RunnerProvider,
} from './provider-adapter.js';
import { ProtocolMetricsCollector, type RunnerMetricsSnapshot } from './protocol-metrics.js';

interface RunnerSession {
  provider: RunnerProvider;
  adapter: ProviderAdapter;
  state: RunnerSessionState;
}

type RunnerSessionState = 'starting' | 'streaming' | 'awaiting_input' | 'completed' | 'failed' | 'fallback_pty';

interface IngestAnnotation {
  expectedInput?: boolean;
  expectedState?: RunnerSessionState;
}

/**
 * Bridges provider raw events to unified runner events with per-session guards.
 * This is intentionally transport-agnostic (SSE/stdio/ws) and can be called by any runner backend.
 */
export class ProtocolRunnerBridge {
  private sessions = new Map<string, RunnerSession>();
  private metrics = new ProtocolMetricsCollector();

  startSession(sessionId: string, provider: ConfigProvider): void {
    const normalizedProvider = provider === 'claude' ? 'claude' : 'codex';
    this.sessions.set(sessionId, {
      provider: normalizedProvider,
      adapter: createProviderAdapter(normalizedProvider),
      state: 'starting',
    });
  }

  ingestRawEvent(sessionId: string, rawEvent: unknown, now?: number): RunnerEvent[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    const annotation = extractAnnotation(rawEvent);
    const normalized = session.adapter.normalizeEvent(rawEvent, { sessionId, now }).events;
    const events = this.applyAutoFallback(sessionId, session, normalized, now);
    this.applyStateFromEvents(session, events);
    this.metrics.recordIngest({
      expectedInput: annotation.expectedInput,
      expectedState: annotation.expectedState,
      actualState: session.state,
      events,
    });
    return events;
  }

  resolveInput(sessionId: string, requestId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    return session.adapter.resolvePendingInput(sessionId, requestId);
  }

  getSessionProvider(sessionId: string): RunnerProvider | null {
    return this.sessions.get(sessionId)?.provider ?? null;
  }

  endSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.adapter.resetSession(sessionId);
    this.sessions.delete(sessionId);
  }

  getMetricsSnapshot(): RunnerMetricsSnapshot {
    return this.metrics.snapshot();
  }

  resetMetrics(): void {
    this.metrics.reset();
  }

  private applyAutoFallback(
    sessionId: string,
    session: RunnerSession,
    events: RunnerEvent[],
    now?: number
  ): RunnerEvent[] {
    let output = events.slice();
    for (const event of events) {
      if (event.type !== 'session.failed') continue;
      const recoverable = Boolean((event as any).recoverable);
      if (!recoverable) continue;

      const ts = now ?? Date.now();
      output = output.concat({
        id: `fallback-${session.provider}-${sessionId}-${ts}-${Math.floor(Math.random() * 1_000_000)}`,
        ts,
        provider: session.provider,
        sessionId,
        type: 'status.changed',
        from: 'failed',
        to: 'fallback_pty',
        reason: 'auto-fallback-on-recoverable-failure',
      } as RunnerEvent);
    }
    return output;
  }

  private applyStateFromEvents(session: RunnerSession, events: RunnerEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'session.started':
          session.state = 'streaming';
          break;
        case 'output.delta':
        case 'output.completed':
          if (session.state !== 'completed' && session.state !== 'failed' && session.state !== 'fallback_pty') {
            session.state = 'streaming';
          }
          break;
        case 'input.requested':
          session.state = 'awaiting_input';
          break;
        case 'status.changed': {
          const to = String((event as any).to || '');
          if (to === 'streaming' || to === 'awaiting_input' || to === 'completed' || to === 'failed' || to === 'fallback_pty') {
            session.state = to;
          }
          break;
        }
        case 'session.completed':
          session.state = 'completed';
          break;
        case 'session.failed':
          session.state = 'failed';
          break;
      }
    }
  }
}

function extractAnnotation(rawEvent: unknown): IngestAnnotation {
  if (!rawEvent || typeof rawEvent !== 'object') return {};
  const record = rawEvent as Record<string, unknown>;
  const expectedInput = typeof record._mc_expected_input === 'boolean' ? record._mc_expected_input : undefined;
  const rawState = typeof record._mc_provider_state === 'string' ? record._mc_provider_state.trim().toLowerCase() : '';
  const expectedState = toRunnerState(rawState);
  return {
    expectedInput,
    expectedState,
  };
}

function toRunnerState(value: string): RunnerSessionState | undefined {
  if (value === 'starting' || value === 'streaming' || value === 'awaiting_input'
    || value === 'completed' || value === 'failed' || value === 'fallback_pty') {
    return value;
  }
  return undefined;
}
