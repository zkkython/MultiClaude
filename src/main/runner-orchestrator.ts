import type { ModelConfig, RunnerStartResult, RunnerUserInput } from '../shared/types.js';
import { AgentStateEngine } from './agent-state-engine.js';
import { ProtocolRunnerBridge } from './protocol-runner-bridge.js';
import type { ProtocolSessionTransport } from './protocol-session-transport.js';

type RunnerEventRecord = Record<string, unknown>;

export interface CreateSessionTransportResult {
  transport: ProtocolSessionTransport;
  transportType: 'pty' | 'http_sse';
}

export interface RunnerOrchestratorDeps {
  agentStateEngine: AgentStateEngine;
  protocolRunnerBridge: ProtocolRunnerBridge;
  createSessionTransport: (config: ModelConfig, sessionId: string, terminalId: string) => CreateSessionTransportResult;
  notifyRunnerEvent: (event: RunnerEventRecord) => void;
}

interface StartSessionInput {
  sessionId: string;
  config: ModelConfig;
  terminalId?: string;
}

export class RunnerOrchestrator {
  private runnerSessionToTerminal = new Map<string, string>();
  private terminalToRunnerSession = new Map<string, string>();
  private runnerTransportBySession = new Map<string, ProtocolSessionTransport>();
  private pendingInputSessions = new Set<string>();
  private pendingSidechannelEventsByTerminal = new Map<string, unknown[]>();

  constructor(private deps: RunnerOrchestratorDeps) {}

  startSession(input: StartSessionInput): RunnerStartResult {
    const { sessionId, config, terminalId } = input;
    this.deps.protocolRunnerBridge.startSession(sessionId, config.provider);
    let transportType: 'pty' | 'http_sse' = 'pty';
    if (terminalId) {
      this.runnerSessionToTerminal.set(sessionId, terminalId);
      this.terminalToRunnerSession.set(terminalId, sessionId);
      const created = this.deps.createSessionTransport(config, sessionId, terminalId);
      const transport = created.transport;
      transportType = created.transportType;
      this.runnerTransportBySession.set(sessionId, transport);
      this.flushPendingSidechannelEvents(terminalId, sessionId);
      if (transport.start) {
        transport.start((rawEvent: unknown) => {
          this.ingestRawEvent(sessionId, rawEvent);
        });
      }
    }
    return {
      sessionId,
      provider: config.provider,
      linkedTerminalId: terminalId,
      transportType,
    };
  }

  ingestRawEvent(sessionId: string, rawEvent: unknown): void {
    const marker = asRunnerEventMarker(rawEvent);
    if (marker) {
      const event = this.enrichLocalRunnerEvent(sessionId, marker);
      this.applyRuntimeStateFromRunnerEvent(sessionId, event);
      this.deps.notifyRunnerEvent(event);
      return;
    }
    const events = this.deps.protocolRunnerBridge.ingestRawEvent(sessionId, rawEvent);
    this.dispatchRunnerEvents(sessionId, events);
  }

  resolveInput(sessionId: string, requestId: string): boolean {
    return this.deps.protocolRunnerBridge.resolveInput(sessionId, requestId);
  }

  submitInput(input: RunnerUserInput): boolean {
    const accepted = this.deps.protocolRunnerBridge.resolveInput(input.sessionId, input.requestId);
    if (!accepted) return false;
    this.pendingInputSessions.delete(input.sessionId);

    const transport = this.runnerTransportBySession.get(input.sessionId);
    if (transport) {
      transport.submitInput(input);
    }

    const provider = this.deps.protocolRunnerBridge.getSessionProvider(input.sessionId) ?? 'codex';
    const localEvent: RunnerEventRecord = {
      id: `runner-local-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
      ts: Date.now(),
      provider,
      sessionId: input.sessionId,
      type: 'status.changed',
      from: 'awaiting_input',
      to: 'streaming',
      reason: input.type,
    };
    this.applyRuntimeStateFromRunnerEvent(input.sessionId, localEvent);
    this.deps.notifyRunnerEvent(localEvent);
    return true;
  }

  interruptSession(sessionId: string): boolean {
    const transport = this.runnerTransportBySession.get(sessionId);
    if (!transport) return false;
    transport.interrupt();
    return true;
  }

  stopSession(sessionId: string): boolean {
    const transport = this.runnerTransportBySession.get(sessionId);
    if (!transport) return false;
    transport.stop();
    return true;
  }

  endSession(sessionId: string): void {
    this.deps.protocolRunnerBridge.endSession(sessionId);
    this.cleanupRunnerSessionById(sessionId);
  }

  ingestTerminalOutput(terminalId: string, chunk: string): void {
    const sessionId = this.terminalToRunnerSession.get(terminalId);
    if (!sessionId || !chunk) return;
    const transport = this.runnerTransportBySession.get(sessionId);
    if (!transport) return;
    const rawEvents = transport.ingestChunk(chunk);
    for (const rawEvent of rawEvents) {
      this.ingestRawEvent(sessionId, rawEvent);
    }
  }

  ingestSidechannelEvent(terminalId: string, event: unknown): void {
    const sessionId = this.terminalToRunnerSession.get(terminalId);
    if (sessionId) {
      this.ingestRawEvent(sessionId, event);
      return;
    }
    this.queuePendingSidechannelEvent(terminalId, event);
  }

  cleanupTerminal(terminalId: string): void {
    const sessionId = this.terminalToRunnerSession.get(terminalId);
    if (sessionId) {
      this.cleanupRunnerSessionById(sessionId);
      this.deps.protocolRunnerBridge.endSession(sessionId);
    }
    this.pendingSidechannelEventsByTerminal.delete(terminalId);
  }

  getMetricsSnapshot() {
    return this.deps.protocolRunnerBridge.getMetricsSnapshot();
  }

  resetMetrics(): void {
    this.deps.protocolRunnerBridge.resetMetrics();
  }

  private dispatchRunnerEvents(sessionId: string, events: RunnerEventRecord[]): void {
    for (const event of events) {
      this.applyRuntimeStateFromRunnerEvent(sessionId, event);
      this.deps.notifyRunnerEvent(event);
      if (event.type === 'session.completed' || event.type === 'session.failed') {
        this.pendingInputSessions.delete(sessionId);
        this.deps.protocolRunnerBridge.endSession(sessionId);
        this.cleanupRunnerSessionById(sessionId);
      }
    }
  }

  private cleanupRunnerSessionById(sessionId: string): void {
    this.pendingInputSessions.delete(sessionId);
    const terminalId = this.runnerSessionToTerminal.get(sessionId);
    if (terminalId) {
      this.terminalToRunnerSession.delete(terminalId);
    }
    this.runnerSessionToTerminal.delete(sessionId);
    this.runnerTransportBySession.delete(sessionId);
  }

  private flushPendingSidechannelEvents(terminalId: string, sessionId: string): void {
    const pending = this.pendingSidechannelEventsByTerminal.get(terminalId);
    if (!pending || pending.length === 0) return;
    this.pendingSidechannelEventsByTerminal.delete(terminalId);
    for (const event of pending) {
      this.ingestRawEvent(sessionId, event);
    }
  }

  private queuePendingSidechannelEvent(terminalId: string, event: unknown): void {
    const pending = this.pendingSidechannelEventsByTerminal.get(terminalId) ?? [];
    pending.push(event);
    if (pending.length > 128) {
      pending.splice(0, pending.length - 128);
    }
    this.pendingSidechannelEventsByTerminal.set(terminalId, pending);
  }

  private applyRuntimeStateFromRunnerEvent(sessionId: string, event: RunnerEventRecord): void {
    const terminalId = this.runnerSessionToTerminal.get(sessionId);
    if (!terminalId) return;
    const type = typeof event.type === 'string' ? event.type : '';
    if (type === 'input.requested') {
      this.pendingInputSessions.add(sessionId);
      this.deps.agentStateEngine.applyExplicitState(terminalId, 'waiting', 'protocol input requested', 'high');
      return;
    }
    if (type === 'status.changed') {
      const to = typeof event.to === 'string' ? event.to : '';
      const hasPendingInput = this.pendingInputSessions.has(sessionId);
      if (to === 'streaming' || to === 'fallback_pty') {
        if (hasPendingInput && !isPendingInputResolvedEvent(event)) {
          return;
        }
        this.pendingInputSessions.delete(sessionId);
        this.deps.agentStateEngine.applyExplicitState(terminalId, 'running', 'protocol session streaming', 'high');
        return;
      }
      if (to === 'idle') {
        if (hasPendingInput) return;
        this.deps.agentStateEngine.applyExplicitState(terminalId, 'idle', 'protocol session idle', 'high');
        return;
      }
      if (to === 'awaiting_input') {
        this.pendingInputSessions.add(sessionId);
        this.deps.agentStateEngine.applyExplicitState(terminalId, 'waiting', 'protocol awaiting input', 'high');
        return;
      }
    }
    if (type === 'session.completed') {
      this.pendingInputSessions.delete(sessionId);
      this.deps.agentStateEngine.applyExplicitState(terminalId, 'idle', 'protocol session completed', 'high');
      return;
    }
    if (type === 'session.failed') {
      this.pendingInputSessions.delete(sessionId);
      this.deps.agentStateEngine.applyExplicitState(terminalId, 'running', 'protocol session failed', 'medium');
    }
  }

  private enrichLocalRunnerEvent(sessionId: string, partial: RunnerEventRecord): RunnerEventRecord {
    const provider = this.deps.protocolRunnerBridge.getSessionProvider(sessionId) ?? 'codex';
    return {
      id: `runner-local-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
      ts: Date.now(),
      provider,
      sessionId,
      ...partial,
    };
  }
}

function isPendingInputResolvedEvent(event: RunnerEventRecord): boolean {
  const reason = typeof event.reason === 'string' ? event.reason.trim().toLowerCase() : '';
  if (reason === 'approval' || reason === 'text') return true;
  const explicitHook = typeof event.hookEventName === 'string'
    ? event.hookEventName.trim().toLowerCase()
    : '';
  const reasonHook = reason.includes(':')
    ? reason.split(':').slice(1).join(':').trim().toLowerCase()
    : '';
  const hookName = explicitHook || reasonHook;
  return hookName === 'userpromptsubmit';
}

function asRunnerEventMarker(rawEvent: unknown): RunnerEventRecord | null {
  if (!rawEvent || typeof rawEvent !== 'object') return null;
  const container = rawEvent as RunnerEventRecord;
  const event = container.__mc_runner_event;
  if (!event || typeof event !== 'object') return null;
  return event as RunnerEventRecord;
}
