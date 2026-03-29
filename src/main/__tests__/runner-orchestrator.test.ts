import test from 'node:test';
import assert from 'node:assert/strict';
import { RunnerOrchestrator } from '../runner-orchestrator.js';
import type { RunnerEvent, RunnerUserInput } from '../../shared/types.js';

interface Harness {
  orchestrator: RunnerOrchestrator;
  notified: RunnerEvent[];
  stateCalls: Array<{ terminalId: string; state: string; reason: string; confidence: string }>;
  bridge: any;
  transport: any;
  counters: {
    interrupt: number;
    stop: number;
    submitInput: number;
    startTransport: number;
    endSession: number;
    resetMetrics: number;
  };
}

function createHarness(overrides?: {
  bridge?: Partial<any>;
  transport?: Partial<any>;
  createSessionTransport?: () => { transport: any; transportType: 'pty' | 'http_sse' };
}): Harness {
  const notified: RunnerEvent[] = [];
  const stateCalls: Array<{ terminalId: string; state: string; reason: string; confidence: string }> = [];
  const counters = {
    interrupt: 0,
    stop: 0,
    submitInput: 0,
    startTransport: 0,
    endSession: 0,
    resetMetrics: 0,
  };

  const transport = {
    submitInput() { counters.submitInput += 1; },
    interrupt() { counters.interrupt += 1; },
    stop() { counters.stop += 1; },
    ingestChunk() { return []; },
    start(_cb: (rawEvent: unknown) => void) { counters.startTransport += 1; },
    ...overrides?.transport,
  };

  const bridge = {
    startSession() {},
    ingestRawEvent() { return []; },
    resolveInput() { return false; },
    getSessionProvider() { return 'codex'; },
    endSession() { counters.endSession += 1; },
    getMetricsSnapshot() { return { counters: { a: 1 }, rates: {}, goals: {} }; },
    resetMetrics() { counters.resetMetrics += 1; },
    ...overrides?.bridge,
  };

  const agentStateEngine = {
    applyExplicitState(terminalId: string, state: string, reason: string, confidence: string) {
      stateCalls.push({ terminalId, state, reason, confidence });
    },
  } as any;

  const orchestrator = new RunnerOrchestrator({
    agentStateEngine,
    protocolRunnerBridge: bridge,
    createSessionTransport: overrides?.createSessionTransport ?? (() => ({ transport: transport as any, transportType: 'pty' })),
    notifyRunnerEvent: (event) => notified.push(event),
  });

  return { orchestrator, notified, stateCalls, bridge, transport, counters };
}

test('flushes queued sidechannel events after session start', () => {
  const { orchestrator, notified } = createHarness();

  orchestrator.ingestSidechannelEvent('t-1', {
    __mc_runner_event: { type: 'status.changed', from: 'awaiting_input', to: 'streaming', reason: 'sidechannel' },
  });
  assert.equal(notified.length, 0);

  const result = orchestrator.startSession({
    sessionId: 'runner-1',
    config: { provider: 'codex' } as any,
    terminalId: 't-1',
  });
  assert.equal(result.sessionId, 'runner-1');
  assert.equal(notified.length, 1);
  assert.equal(notified[0].sessionId, 'runner-1');
  assert.equal(notified[0].type, 'status.changed');
});

test('submitInput forwards to transport and emits local status event', () => {
  let submitted: RunnerUserInput | null = null;
  const { orchestrator, notified, counters } = createHarness({
    bridge: {
      resolveInput() { return true; },
      getSessionProvider() { return 'claude'; },
    },
    transport: {
      submitInput(input: RunnerUserInput) {
        submitted = input;
      },
    },
  });

  orchestrator.startSession({
    sessionId: 'runner-2',
    config: { provider: 'claude' } as any,
    terminalId: 't-2',
  });

  const input: RunnerUserInput = {
    sessionId: 'runner-2',
    requestId: 'req-1',
    type: 'user_response',
    text: 'yes',
  };

  assert.equal(orchestrator.submitInput(input), true);
  assert.deepEqual(submitted, input);
  assert.equal(notified.at(-1)?.type, 'status.changed');
  assert.equal(notified.at(-1)?.provider, 'claude');
  assert.equal(counters.endSession, 0);
});

test('cleanupTerminal ends session and detaches transport mappings', () => {
  const { orchestrator, counters } = createHarness();

  orchestrator.startSession({
    sessionId: 'runner-3',
    config: { provider: 'codex' } as any,
    terminalId: 't-3',
  });
  assert.equal(orchestrator.interruptSession('runner-3'), true);
  assert.equal(counters.interrupt, 1);

  orchestrator.cleanupTerminal('t-3');
  assert.equal(counters.endSession, 1);
  assert.equal(orchestrator.interruptSession('runner-3'), false);
});

test('startSession without terminal keeps pty default and no transport actions', () => {
  const { orchestrator, counters } = createHarness();
  const result = orchestrator.startSession({
    sessionId: 'runner-no-terminal',
    config: { provider: 'codex' } as any,
  });
  assert.equal(result.transportType, 'pty');
  assert.equal(result.linkedTerminalId, undefined);
  assert.equal(counters.startTransport, 0);
});

test('status and input marker events map into runtime state transitions', () => {
  const { orchestrator, stateCalls } = createHarness();
  orchestrator.startSession({
    sessionId: 'runner-state',
    config: { provider: 'codex' } as any,
    terminalId: 't-state',
  });

  orchestrator.ingestRawEvent('runner-state', {
    __mc_runner_event: { type: 'input.requested', prompt: 'Approve?' },
  });
  orchestrator.ingestRawEvent('runner-state', {
    __mc_runner_event: { type: 'status.changed', to: 'awaiting_input' },
  });
  orchestrator.ingestRawEvent('runner-state', {
    __mc_runner_event: { type: 'status.changed', to: 'streaming', reason: 'approval' },
  });
  orchestrator.ingestRawEvent('runner-state', {
    __mc_runner_event: { type: 'status.changed', to: 'idle' },
  });

  assert.equal(stateCalls.some((call) => call.state === 'waiting' && call.reason.includes('input')), true);
  assert.equal(stateCalls.some((call) => call.state === 'running' && call.reason.includes('streaming')), true);
  assert.equal(stateCalls.some((call) => call.state === 'idle' && call.reason.includes('idle')), true);
});

test('streaming status is ignored while pending input is unresolved', () => {
  const { orchestrator, stateCalls } = createHarness();
  orchestrator.startSession({
    sessionId: 'runner-pending',
    config: { provider: 'codex' } as any,
    terminalId: 't-pending',
  });

  orchestrator.ingestRawEvent('runner-pending', {
    __mc_runner_event: { type: 'input.requested', prompt: 'Waiting' },
  });
  const before = stateCalls.length;
  orchestrator.ingestRawEvent('runner-pending', {
    __mc_runner_event: { type: 'status.changed', to: 'streaming', reason: 'still waiting' },
  });
  assert.equal(stateCalls.length, before);
});

test('bridge events complete/failed clean up mappings and resolve state', () => {
  const bridge = {
    ingestRawEvent(_sessionId: string, rawEvent: any) {
      if (rawEvent?.kind === 'completed') {
        return [
          {
            id: 'evt-1',
            ts: Date.now(),
            provider: 'codex',
            sessionId: 'runner-done',
            type: 'session.completed',
          },
        ];
      }
      return [
        {
          id: 'evt-2',
          ts: Date.now(),
          provider: 'codex',
          sessionId: 'runner-fail',
          type: 'session.failed',
          error: 'boom',
          recoverable: true,
        },
      ];
    },
  };
  const { orchestrator, stateCalls, counters } = createHarness({ bridge });

  orchestrator.startSession({
    sessionId: 'runner-done',
    config: { provider: 'codex' } as any,
    terminalId: 't-done',
  });
  orchestrator.ingestRawEvent('runner-done', { kind: 'completed' });
  assert.equal(stateCalls.some((call) => call.terminalId === 't-done' && call.state === 'idle'), true);
  assert.equal(orchestrator.stopSession('runner-done'), false);

  orchestrator.startSession({
    sessionId: 'runner-fail',
    config: { provider: 'codex' } as any,
    terminalId: 't-fail',
  });
  orchestrator.ingestRawEvent('runner-fail', { kind: 'failed' });
  assert.equal(stateCalls.some((call) => call.terminalId === 't-fail' && call.reason.includes('failed')), true);
  assert.equal(counters.endSession >= 2, true);
});

test('ingestTerminalOutput forwards parsed chunk events and resolves input via bridge', () => {
  const ingested: Array<{ sessionId: string; rawEvent: unknown }> = [];
  const resolved: Array<{ sessionId: string; requestId: string }> = [];
  const { orchestrator, notified } = createHarness({
    bridge: {
      ingestRawEvent(sessionId: string, rawEvent: unknown) {
        ingested.push({ sessionId, rawEvent });
        return [];
      },
      resolveInput(sessionId: string, requestId: string) {
        resolved.push({ sessionId, requestId });
        return requestId === 'ok';
      },
    },
    transport: {
      ingestChunk() {
        return [{ __mc_runner_event: { type: 'status.changed', to: 'streaming', reason: 'approval' } }];
      },
    },
  });

  orchestrator.startSession({
    sessionId: 'runner-out',
    config: { provider: 'codex' } as any,
    terminalId: 't-out',
  });

  orchestrator.ingestTerminalOutput('t-out', 'chunk');
  assert.equal(ingested.length, 0);
  assert.equal(notified.length, 1);
  assert.equal(orchestrator.resolveInput('runner-out', 'ok'), true);
  assert.deepEqual(resolved[0], { sessionId: 'runner-out', requestId: 'ok' });
});

test('sidechannel queue is capped and metrics/reset passthrough works', () => {
  const { orchestrator, notified, counters } = createHarness({
    bridge: {
      getMetricsSnapshot() { return { counters: { sessions: 2 }, rates: { ok: 1 }, goals: {} }; },
    },
  });

  for (let i = 0; i < 140; i += 1) {
    orchestrator.ingestSidechannelEvent('t-cap', {
      __mc_runner_event: {
        type: 'status.changed',
        to: 'streaming',
        reason: `side:${i}`,
      },
    });
  }

  orchestrator.startSession({
    sessionId: 'runner-cap',
    config: { provider: 'codex' } as any,
    terminalId: 't-cap',
  });
  assert.equal(notified.length, 128);
  assert.equal((notified[0].reason || '').includes('side:12'), true);

  const metrics = orchestrator.getMetricsSnapshot();
  assert.deepEqual(metrics.counters, { sessions: 2 });
  orchestrator.resetMetrics();
  assert.equal(counters.resetMetrics, 1);
});

test('transport control helpers return false when session has no transport', () => {
  const { orchestrator } = createHarness();
  assert.equal(orchestrator.interruptSession('missing'), false);
  assert.equal(orchestrator.stopSession('missing'), false);
  assert.equal(orchestrator.submitInput({
    sessionId: 'missing',
    requestId: 'none',
    type: 'user_response',
    text: 'x',
  }), false);
});
