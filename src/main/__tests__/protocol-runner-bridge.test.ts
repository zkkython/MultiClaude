import test from 'node:test';
import assert from 'node:assert/strict';
import { ProtocolRunnerBridge } from '../protocol-runner-bridge.js';

test('bridge tracks provider, state transitions and input resolution', () => {
  const bridge = new ProtocolRunnerBridge();
  bridge.startSession('sess-1', 'claude');
  assert.equal(bridge.getSessionProvider('sess-1'), 'claude');

  const started = bridge.ingestRawEvent('sess-1', { type: 'message_start' }, 10);
  assert.equal(started[0].type, 'session.started');

  const waiting = bridge.ingestRawEvent('sess-1', {
    type: 'message_stop',
    stop_reason: 'tool_use',
    request_id: 'req-1',
  }, 11);
  assert.equal(waiting[0].type, 'input.requested');
  assert.equal(bridge.resolveInput('sess-1', 'req-1'), true);
  assert.equal(bridge.resolveInput('sess-1', 'req-1'), false);

  const completed = bridge.ingestRawEvent('sess-1', {
    type: 'message_stop',
    stop_reason: 'end_turn',
  }, 12);
  assert.equal(completed[0].type, 'session.completed');

  bridge.endSession('sess-1');
  assert.equal(bridge.getSessionProvider('sess-1'), null);
  assert.deepEqual(bridge.ingestRawEvent('sess-1', { type: 'message_start' }, 13), []);
});

test('bridge appends fallback status.changed on recoverable session failure', () => {
  const bridge = new ProtocolRunnerBridge();
  bridge.startSession('sess-2', 'codex');

  const events = bridge.ingestRawEvent('sess-2', {
    type: 'response.failed',
    error: { message: 'timeout contacting provider', code: 'E_TIMEOUT' },
  }, 20);
  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'session.failed');
  assert.equal((events[0] as any).recoverable, true);
  assert.equal(events[1].type, 'status.changed');
  assert.equal((events[1] as any).to, 'fallback_pty');
});

test('bridge does not fallback for non-recoverable auth failures', () => {
  const bridge = new ProtocolRunnerBridge();
  bridge.startSession('sess-3', 'codex');

  const events = bridge.ingestRawEvent('sess-3', {
    type: 'response.failed',
    error: { message: '401 unauthorized', code: '401' },
  }, 30);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'session.failed');
  assert.equal((events[0] as any).recoverable, false);
});

test('bridge exposes and resets protocol metrics snapshot', () => {
  const bridge = new ProtocolRunnerBridge();
  bridge.startSession('sess-4', 'claude');
  bridge.ingestRawEvent('sess-4', {
    type: 'message_stop',
    stop_reason: 'tool_use',
    request_id: 'req-x',
    _mc_expected_input: true,
    _mc_provider_state: 'awaiting_input',
  }, 40);

  const snapshot = bridge.getMetricsSnapshot();
  assert.equal(snapshot.counters.interactionExpectedTotal >= 1, true);
  assert.equal(snapshot.counters.interactionTriggeredTotal >= 1, true);

  bridge.resetMetrics();
  const cleared = bridge.getMetricsSnapshot();
  assert.equal(cleared.counters.interactionExpectedTotal, 0);
});
