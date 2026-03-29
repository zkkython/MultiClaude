import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ClaudeProviderAdapter,
  CodexProviderAdapter,
  createProviderAdapter,
} from '../provider-adapter.js';

test('createProviderAdapter returns provider-specific adapters', () => {
  assert.equal(createProviderAdapter('claude') instanceof ClaudeProviderAdapter, true);
  assert.equal(createProviderAdapter('codex') instanceof CodexProviderAdapter, true);
});

test('claude adapter normalizes start/delta/completed events', () => {
  const adapter = new ClaudeProviderAdapter();
  const sessionId = 's-claude-1';

  const started = adapter.normalizeEvent({ type: 'message_start' }, { sessionId, now: 10 }).events;
  assert.equal(started.length, 1);
  assert.equal(started[0].type, 'session.started');

  const delta = adapter.normalizeEvent({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: 'hello' },
  }, { sessionId, now: 11 }).events;
  assert.equal(delta.length, 1);
  assert.equal(delta[0].type, 'output.delta');
  assert.equal((delta[0] as any).text, 'hello');

  const completed = adapter.normalizeEvent({
    type: 'message_stop',
    stop_reason: 'end_turn',
  }, { sessionId, now: 12 }).events;
  assert.equal(completed.length, 1);
  assert.equal(completed[0].type, 'session.completed');
});

test('claude adapter guards duplicate and concurrent input requests', () => {
  const adapter = new ClaudeProviderAdapter();
  const sessionId = 's-claude-2';

  const first = adapter.normalizeEvent({
    type: 'message_stop',
    stop_reason: 'tool_use',
    request_id: 'req-1',
    tool_use: { name: 'run_cmd' },
  }, { sessionId, now: 20 }).events;
  assert.equal(first.length, 1);
  assert.equal(first[0].type, 'input.requested');

  const dup = adapter.normalizeEvent({
    type: 'message_stop',
    stop_reason: 'tool_use',
    request_id: 'req-1',
  }, { sessionId, now: 21 }).events;
  assert.equal(dup.length, 0);

  const concurrent = adapter.normalizeEvent({
    type: 'message_stop',
    stop_reason: 'tool_use',
    request_id: 'req-2',
  }, { sessionId, now: 22 }).events;
  assert.equal(concurrent.length, 1);
  assert.equal(concurrent[0].type, 'session.failed');
  assert.equal((concurrent[0] as any).code, 'PROTOCOL_PARSE_ERROR');
});

test('claude adapter resolves pending input and maps error recoverability', () => {
  const adapter = new ClaudeProviderAdapter();
  const sessionId = 's-claude-3';

  adapter.normalizeEvent({
    type: 'message_stop',
    stop_reason: 'tool_use',
    request_id: 'req-1',
  }, { sessionId, now: 30 });
  assert.equal(adapter.resolvePendingInput(sessionId, 'req-1'), true);
  assert.equal(adapter.resolvePendingInput(sessionId, 'req-1'), false);

  const failed = adapter.normalizeEvent({
    type: 'error',
    error: { code: '401', message: 'unauthorized' },
  }, { sessionId, now: 31 }).events;
  assert.equal(failed.length, 1);
  assert.equal(failed[0].type, 'session.failed');
  assert.equal((failed[0] as any).recoverable, false);
});

test('codex adapter normalizes core event paths', () => {
  const adapter = new CodexProviderAdapter();
  const sessionId = 's-codex-1';

  const started = adapter.normalizeEvent({ type: 'response.created' }, { sessionId, now: 40 }).events;
  assert.equal(started[0].type, 'session.started');

  const delta = adapter.normalizeEvent({
    type: 'response.output_text.delta',
    delta: 'abc',
  }, { sessionId, now: 41 }).events;
  assert.equal(delta[0].type, 'output.delta');
  assert.equal((delta[0] as any).text, 'abc');

  const input = adapter.normalizeEvent({
    type: 'run.requires_action',
    required_action: { submit_tool_outputs: { tool_calls: [{ id: 'call-1', function: { name: 'tool-a' } }] } },
  }, { sessionId, now: 42 }).events;
  assert.equal(input[0].type, 'input.requested');
  assert.equal((input[0] as any).requestId, 'call-1');

  const failed = adapter.normalizeEvent({
    type: 'response.failed',
    error: { message: 'timeout waiting upstream', code: 'E_TIMEOUT' },
  }, { sessionId, now: 43 }).events;
  assert.equal(failed[0].type, 'session.failed');
  assert.equal((failed[0] as any).code, 'PROTOCOL_TIMEOUT');
});

test('adapter emits parse failure when raw event has no type', () => {
  const claude = new ClaudeProviderAdapter();
  const codex = new CodexProviderAdapter();
  const c = claude.normalizeEvent({}, { sessionId: 's1', now: 1 }).events[0];
  const o = codex.normalizeEvent({}, { sessionId: 's2', now: 1 }).events[0];
  assert.equal(c.type, 'session.failed');
  assert.equal(o.type, 'session.failed');
});
