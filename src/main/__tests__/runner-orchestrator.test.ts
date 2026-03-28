import test from 'node:test';
import assert from 'node:assert/strict';
import { RunnerOrchestrator } from '../runner-orchestrator.js';
import type { RunnerUserInput } from '../../shared/types.js';

test('flushes queued sidechannel events after session start', () => {
  const notified: Array<Record<string, unknown>> = [];
  const bridge = {
    startSession() {},
    ingestRawEvent() { return []; },
    resolveInput() { return false; },
    getSessionProvider() { return 'codex'; },
    endSession() {},
    getMetricsSnapshot() { return { counters: {}, rates: {}, goals: {} }; },
    resetMetrics() {},
  } as any;
  const agentStateEngine = {
    applyExplicitState() {},
  } as any;

  const transport = {
    submitInput() {},
    interrupt() {},
    stop() {},
    ingestChunk() { return []; },
    start(_cb: (rawEvent: unknown) => void) {},
  };

  const orchestrator = new RunnerOrchestrator({
    agentStateEngine,
    protocolRunnerBridge: bridge,
    createSessionTransport: () => ({ transport: transport as any, transportType: 'pty' }),
    notifyRunnerEvent: (event) => notified.push(event),
  });

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
  const notified: Array<Record<string, unknown>> = [];
  let submitted: RunnerUserInput | null = null;
  let endSessionCalls = 0;
  const bridge = {
    startSession() {},
    ingestRawEvent() { return []; },
    resolveInput() { return true; },
    getSessionProvider() { return 'claude'; },
    endSession() { endSessionCalls += 1; },
    getMetricsSnapshot() { return { counters: {}, rates: {}, goals: {} }; },
    resetMetrics() {},
  } as any;
  const agentStateEngine = {
    applyExplicitState() {},
  } as any;
  const transport = {
    submitInput(input: RunnerUserInput) { submitted = input; },
    interrupt() {},
    stop() {},
    ingestChunk() { return []; },
    start(_cb: (rawEvent: unknown) => void) {},
  };

  const orchestrator = new RunnerOrchestrator({
    agentStateEngine,
    protocolRunnerBridge: bridge,
    createSessionTransport: () => ({ transport: transport as any, transportType: 'pty' }),
    notifyRunnerEvent: (event) => notified.push(event),
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
  assert.equal(endSessionCalls, 0);
});

test('cleanupTerminal ends session and detaches transport mappings', () => {
  let interrupted = 0;
  let endSessionCalls = 0;
  const bridge = {
    startSession() {},
    ingestRawEvent() { return []; },
    resolveInput() { return false; },
    getSessionProvider() { return 'codex'; },
    endSession() { endSessionCalls += 1; },
    getMetricsSnapshot() { return { counters: {}, rates: {}, goals: {} }; },
    resetMetrics() {},
  } as any;
  const agentStateEngine = {
    applyExplicitState() {},
  } as any;
  const transport = {
    submitInput() {},
    interrupt() { interrupted += 1; },
    stop() {},
    ingestChunk() { return []; },
    start(_cb: (rawEvent: unknown) => void) {},
  };

  const orchestrator = new RunnerOrchestrator({
    agentStateEngine,
    protocolRunnerBridge: bridge,
    createSessionTransport: () => ({ transport: transport as any, transportType: 'pty' }),
    notifyRunnerEvent() {},
  });

  orchestrator.startSession({
    sessionId: 'runner-3',
    config: { provider: 'codex' } as any,
    terminalId: 't-3',
  });
  assert.equal(orchestrator.interruptSession('runner-3'), true);
  assert.equal(interrupted, 1);

  orchestrator.cleanupTerminal('t-3');
  assert.equal(endSessionCalls, 1);
  assert.equal(orchestrator.interruptSession('runner-3'), false);
});
