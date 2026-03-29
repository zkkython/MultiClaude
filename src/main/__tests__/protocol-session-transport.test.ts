import test from 'node:test';
import assert from 'node:assert/strict';
import { PtyProtocolSessionTransport } from '../protocol-session-transport.js';

test('ingestChunk parses json lines, strips ansi, and preserves trailing buffer', () => {
  const transport = new PtyProtocolSessionTransport({
    write: () => {},
    kill: () => {},
  });

  const chunkA = [
    '\u001b[32mdata: {"type":"event.a","value":1}\u001b[0m',
    'not-json',
    '{"type":"event.b"}',
    'data: [DONE]',
    'data: {"type":"partial"',
  ].join('\n');

  const first = transport.ingestChunk(chunkA);
  assert.deepEqual(first, [
    { type: 'event.a', value: 1 },
    { type: 'event.b' },
  ]);

  const second = transport.ingestChunk(',"value":2}\n');
  assert.deepEqual(second, [
    { type: 'partial', value: 2 },
  ]);
});

test('ingestChunk returns empty array for empty chunk and malformed json payload', () => {
  const transport = new PtyProtocolSessionTransport({
    write: () => {},
    kill: () => {},
  });

  assert.deepEqual(transport.ingestChunk(''), []);
  assert.deepEqual(transport.ingestChunk('data: {"type": bad}\n'), []);
  assert.deepEqual(transport.ingestChunk('data: hello\n'), []);
});

test('submitInput maps runner user inputs to terminal writes', () => {
  const writes: string[] = [];
  const transport = new PtyProtocolSessionTransport({
    write: (data) => writes.push(data),
    kill: () => {},
  });

  transport.submitInput({ type: 'user_response', requestId: 'r-1', text: 'go' });
  transport.submitInput({ type: 'user_response', requestId: 'r-2' });
  transport.submitInput({ type: 'user_approve', requestId: 'r-3' });
  transport.submitInput({ type: 'user_reject', requestId: 'r-4' });
  transport.submitInput({ type: 'user_cancel', requestId: 'r-5' } as any);

  assert.deepEqual(writes, ['go\r', '\r', 'y\r', 'n\r', '\r']);
});

test('interrupt and stop call underlying terminal controls', () => {
  const writes: string[] = [];
  let killCount = 0;
  const transport = new PtyProtocolSessionTransport({
    write: (data) => writes.push(data),
    kill: () => { killCount += 1; },
  });

  transport.interrupt();
  transport.stop();

  assert.deepEqual(writes, ['\x03']);
  assert.equal(killCount, 1);
});
