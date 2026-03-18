import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSidechannelPayload,
  readSidechannelTokenFromHeaders,
  readTerminalIdFromPayload,
} from '../runner-sidechannel-gateway.js';

test('reads sidechannel token from headers', () => {
  assert.equal(readSidechannelTokenFromHeaders({ 'x-mc-runner-token': ' abc ' }), 'abc');
  assert.equal(readSidechannelTokenFromHeaders({ authorization: 'Bearer  tok-1 ' }), 'tok-1');
  assert.equal(readSidechannelTokenFromHeaders({}), null);
});

test('reads terminal id from compatible payload keys', () => {
  assert.equal(readTerminalIdFromPayload({ terminalId: 't-1' }), 't-1');
  assert.equal(readTerminalIdFromPayload({ termId: 't-2' }), 't-2');
  assert.equal(readTerminalIdFromPayload({ tid: 't-3' }), 't-3');
  assert.equal(readTerminalIdFromPayload({}), null);
});

test('normalizes raw and marker events', () => {
  const raw = { foo: 'bar' };
  assert.deepEqual(normalizeSidechannelPayload({ rawEvent: raw }, 't-x'), raw);
  assert.deepEqual(normalizeSidechannelPayload({ runnerEvent: { type: 'session.started' } }, 't-x'), {
    __mc_runner_event: { type: 'session.started' },
  });
  assert.deepEqual(normalizeSidechannelPayload({ event: { type: 'output.delta' } }, 't-x'), {
    type: 'output.delta',
  });
});

test('normalizes waiting/running state payloads', () => {
  const waiting = normalizeSidechannelPayload(
    { state: 'waiting', requestId: 'req-1', inputKind: 'text', prompt: 'p' },
    't-9'
  ) as Record<string, unknown>;
  const waitingEvent = waiting.__mc_runner_event as Record<string, unknown>;
  assert.equal(waitingEvent.type, 'input.requested');
  assert.equal(waitingEvent.requestId, 'req-1');
  assert.equal(waitingEvent.inputKind, 'text');

  const running = normalizeSidechannelPayload({ state: 'running' }, 't-9') as Record<string, unknown>;
  const runningEvent = running.__mc_runner_event as Record<string, unknown>;
  assert.equal(runningEvent.type, 'status.changed');
  assert.equal(runningEvent.to, 'streaming');
});
