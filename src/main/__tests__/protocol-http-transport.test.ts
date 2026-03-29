import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpSseProtocolSessionTransport } from '../protocol-http-transport.js';

type FetchCall = { url: string; init?: RequestInit };

function withMockFetch(
  impl: (url: string, init?: RequestInit) => Promise<any>,
  run: (calls: FetchCall[]) => Promise<void> | void
): Promise<void> {
  const previousFetch = (globalThis as any).fetch;
  const calls: FetchCall[] = [];
  (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return impl(url, init);
  };
  return Promise.resolve(run(calls)).finally(() => {
    (globalThis as any).fetch = previousFetch;
  });
}

test('ingestChunk parses json payload lines and preserves incomplete buffer', () => {
  const transport = new HttpSseProtocolSessionTransport({
    sessionId: 's-1',
    inputUrl: 'https://x/input',
  });

  const chunkA = '\u001b[31mdata: {"a":1}\u001b[0m\n{"b":2}\ndata: [DONE]\n{"partial"';
  const eventsA = transport.ingestChunk(chunkA);
  assert.deepEqual(eventsA, [{ a: 1 }, { b: 2 }]);

  const eventsB = transport.ingestChunk(':3}\nnot-json\n');
  assert.deepEqual(eventsB, [{ partial: 3 }]);
});

test('submit/interrupt/stop send expected POST payloads', async () => {
  await withMockFetch(
    async () => ({ ok: true, status: 200 }),
    async (calls) => {
      const transport = new HttpSseProtocolSessionTransport({
        sessionId: 'sess-1',
        inputUrl: 'https://api/input',
        interruptUrl: 'https://api/interrupt',
        stopUrl: 'https://api/stop',
        headers: { 'x-test': '1' },
      });
      transport.submitInput({ sessionId: 'sess-1', requestId: 'req-1', type: 'user_response', text: 'hi' });
      transport.interrupt();
      transport.stop();
      await new Promise((resolve) => setTimeout(resolve, 0));

      assert.equal(calls.length, 3);
      assert.equal(calls[0].url, 'https://api/input');
      assert.equal(calls[1].url, 'https://api/interrupt');
      assert.equal(calls[2].url, 'https://api/stop');
      const body0 = JSON.parse(String(calls[0].init?.body));
      assert.equal(body0.requestId, 'req-1');
      assert.equal(body0.text, 'hi');
      assert.equal((calls[0].init?.headers as any)['x-test'], '1');
    }
  );
});

test('start emits protocol error for non-retry http status', async () => {
  await withMockFetch(
    async () => ({ ok: false, status: 404 }),
    async () => {
      const transport = new HttpSseProtocolSessionTransport({
        sessionId: 'sess-1',
        streamUrl: 'https://api/stream',
        inputUrl: 'https://api/input',
      });
      const events: any[] = [];
      transport.start((ev) => events.push(ev));
      await new Promise((resolve) => setTimeout(resolve, 0));

      assert.equal(events.length, 2);
      assert.equal(events[0].__mc_runner_event.type, 'status.changed');
      assert.equal(events[1].type, 'error');
      assert.equal(events[1].error.code, 'HTTP_404');
    }
  );
});

test('start emits reconnect exhausted error when retry budget is zero', async () => {
  await withMockFetch(
    async () => ({ ok: false, status: 500 }),
    async () => {
      const transport = new HttpSseProtocolSessionTransport({
        sessionId: 'sess-1',
        streamUrl: 'https://api/stream',
        inputUrl: 'https://api/input',
        reconnectMax: 0,
      });
      const events: any[] = [];
      transport.start((ev) => events.push(ev));
      await new Promise((resolve) => setTimeout(resolve, 0));

      assert.equal(events.length, 2);
      assert.equal(events[1].type, 'error');
      assert.equal(events[1].error.code, 'STREAM_RECONNECT_EXHAUSTED');
    }
  );
});
