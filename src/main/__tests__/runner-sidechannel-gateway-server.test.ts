import test from 'node:test';
import assert from 'node:assert/strict';
import type * as http from 'http';
import { RunnerSidechannelGateway } from '../runner-sidechannel-gateway.js';

class FakeResponse {
  statusCode = 0;
  body = '';

  writeHead(statusCode: number): void {
    this.statusCode = statusCode;
  }

  end(body = ''): void {
    this.body = body;
  }
}

class FakeServer {
  private onError: ((err: Error) => void) | null = null;
  private readonly handler: http.RequestListener;
  private closed = false;
  private readonly failListenErr: Error | null;
  private readonly boundPort: number;

  constructor(handler: http.RequestListener, input?: { failListenErr?: Error; port?: number }) {
    this.handler = handler;
    this.failListenErr = input?.failListenErr ?? null;
    this.boundPort = input?.port ?? 45811;
  }

  once(_event: 'error', listener: (err: Error) => void): void {
    this.onError = listener;
  }

  listen(_port: number, _host: string, callback: () => void): void {
    if (this.failListenErr) {
      this.onError?.(this.failListenErr);
      return;
    }
    callback();
  }

  address(): ReturnType<http.Server['address']> {
    return {
      port: this.boundPort,
      family: 'IPv4',
      address: '127.0.0.1',
    };
  }

  close(callback: () => void): void {
    this.closed = true;
    callback();
  }

  async dispatch(input: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<FakeResponse> {
    const req = {
      method: input.method ?? 'POST',
      url: input.url ?? '/v1/runner/event',
      headers: input.headers ?? {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(input.body ?? '', 'utf8');
      },
    } as unknown as http.IncomingMessage;

    const res = new FakeResponse() as unknown as http.ServerResponse<http.IncomingMessage>;
    this.handler(req, res);
    await new Promise<void>((resolve) => setImmediate(resolve));
    return res as unknown as FakeResponse;
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

test('gateway injectEnv starts server and handles accepted request', async () => {
  const ingested: Array<{ terminalId: string; event: unknown }> = [];
  let fakeServer: FakeServer | null = null;

  const gateway = new RunnerSidechannelGateway(
    {
      ingestEvent: (terminalId, event) => {
        ingested.push({ terminalId, event });
      },
    },
    {
      createToken: () => 'tok-1',
      createServer: (handler) => {
        fakeServer = new FakeServer(handler, { port: 44556 });
        return fakeServer;
      },
    }
  );

  const env: Record<string, string> = {};
  await gateway.injectEnv('term-1', env);
  assert.equal(env.MC_RUNNER_EVENT_URL, 'http://127.0.0.1:44556/v1/runner/event');
  assert.equal(env.MC_RUNNER_EVENT_TOKEN, 'tok-1');
  assert.equal(env.MC_RUNNER_TERMINAL_ID, 'term-1');

  const accepted = await fakeServer!.dispatch({
    headers: { 'x-mc-runner-token': 'tok-1' },
    body: JSON.stringify({ terminalId: 'term-1', event: { type: 'output.delta', text: 'ok' } }),
  });
  assert.equal(accepted.statusCode, 202);
  assert.equal(accepted.body, 'accepted');
  assert.deepEqual(ingested, [
    {
      terminalId: 'term-1',
      event: { type: 'output.delta', text: 'ok' },
    },
  ]);

  await gateway.close();
  assert.equal(fakeServer!.isClosed, true);
});

test('gateway handles validation/auth failures and sidechannel state normalization', async () => {
  let fakeServer: FakeServer | null = null;
  const ingested: Array<{ terminalId: string; event: unknown }> = [];
  const gateway = new RunnerSidechannelGateway(
    {
      ingestEvent: (terminalId, event) => {
        ingested.push({ terminalId, event });
      },
    },
    {
      createToken: () => 'tok-2',
      createServer: (handler) => {
        fakeServer = new FakeServer(handler);
        return fakeServer;
      },
    }
  );

  await gateway.injectEnv('term-2', {});

  const methodNotAllowed = await fakeServer!.dispatch({ method: 'GET' });
  assert.equal(methodNotAllowed.statusCode, 405);
  assert.equal(methodNotAllowed.body, 'method_not_allowed');

  const notFound = await fakeServer!.dispatch({ url: '/other/path', body: '{}' });
  assert.equal(notFound.statusCode, 404);
  assert.equal(notFound.body, 'not_found');

  const invalidJson = await fakeServer!.dispatch({
    headers: { 'x-mc-runner-token': 'tok-2' },
    body: '{"bad":',
  });
  assert.equal(invalidJson.statusCode, 400);
  assert.equal(invalidJson.body, 'invalid_json');

  const invalidPayload = await fakeServer!.dispatch({
    headers: { 'x-mc-runner-token': 'tok-2' },
    body: '[]',
  });
  assert.equal(invalidPayload.statusCode, 400);
  assert.equal(invalidPayload.body, 'invalid_payload');

  const missingTerminalId = await fakeServer!.dispatch({
    headers: { 'x-mc-runner-token': 'tok-2' },
    body: JSON.stringify({ event: { type: 'x' } }),
  });
  assert.equal(missingTerminalId.statusCode, 400);
  assert.equal(missingTerminalId.body, 'missing_terminal_id');

  const missingToken = await fakeServer!.dispatch({
    body: JSON.stringify({ terminalId: 'term-2', event: { type: 'x' } }),
  });
  assert.equal(missingToken.statusCode, 401);
  assert.equal(missingToken.body, 'unauthorized');

  const wrongToken = await fakeServer!.dispatch({
    headers: { authorization: 'Bearer wrong' },
    body: JSON.stringify({ terminalId: 'term-2', event: { type: 'x' } }),
  });
  assert.equal(wrongToken.statusCode, 401);
  assert.equal(wrongToken.body, 'unauthorized');

  const missingEvent = await fakeServer!.dispatch({
    headers: { 'x-mc-runner-token': 'tok-2' },
    body: JSON.stringify({ terminalId: 'term-2' }),
  });
  assert.equal(missingEvent.statusCode, 400);
  assert.equal(missingEvent.body, 'missing_event');

  const waiting = await fakeServer!.dispatch({
    headers: { authorization: 'Bearer tok-2' },
    body: JSON.stringify({
      terminalId: 'term-2',
      state: 'waiting',
      requestId: 'req-2',
      inputKind: 'text',
      prompt: 'Need input',
      rawHookEvent: { hook_event_name: 'awaiting_user_input' },
    }),
  });
  assert.equal(waiting.statusCode, 202);
  assert.equal(waiting.body, 'accepted');

  const running = await fakeServer!.dispatch({
    headers: { 'x-mc-runner-token': 'tok-2' },
    body: JSON.stringify({ terminalId: 'term-2', state: 'running', hookEventName: 'resume' }),
  });
  assert.equal(running.statusCode, 202);

  const idle = await fakeServer!.dispatch({
    headers: { 'x-mc-runner-token': 'tok-2' },
    body: JSON.stringify({ terminalId: 'term-2', state: 'idle' }),
  });
  assert.equal(idle.statusCode, 202);
  assert.equal(ingested.length, 3);

  gateway.cleanupTerminal('term-2');
  const terminalNotFound = await fakeServer!.dispatch({
    headers: { 'x-mc-runner-token': 'tok-2' },
    body: JSON.stringify({ terminalId: 'term-2', event: { type: 'x' } }),
  });
  assert.equal(terminalNotFound.statusCode, 404);
  assert.equal(terminalNotFound.body, 'terminal_not_found');

  await gateway.close();
});

test('gateway rejects payloads over max body size and supports restart after close', async () => {
  const servers: FakeServer[] = [];
  const gateway = new RunnerSidechannelGateway(
    {
      ingestEvent: () => {},
    },
    {
      createToken: () => 'tok-max',
      createServer: (handler) => {
        const srv = new FakeServer(handler, { port: 40000 + servers.length });
        servers.push(srv);
        return srv;
      },
    }
  );

  const envA: Record<string, string> = {};
  await gateway.injectEnv('term-a', envA);
  const huge = 'x'.repeat(128 * 1024 + 16);
  const tooLarge = await servers[0].dispatch({
    headers: { 'x-mc-runner-token': 'tok-max' },
    body: JSON.stringify({ terminalId: 'term-a', event: huge }),
  });
  assert.equal(tooLarge.statusCode, 413);
  assert.equal(tooLarge.body, 'payload_too_large');

  await gateway.close();

  const envB: Record<string, string> = {};
  await gateway.injectEnv('term-b', envB);
  assert.notEqual(envA.MC_RUNNER_EVENT_URL, envB.MC_RUNNER_EVENT_URL);
  await gateway.close();
});

test('gateway propagates listen errors and handles invalid listen address', async () => {
  const listenFailed = new RunnerSidechannelGateway(
    { ingestEvent: () => {} },
    {
      createServer: (handler) => new FakeServer(handler, { failListenErr: new Error('listen failed') }),
    }
  );
  await assert.rejects(() => listenFailed.injectEnv('term-err', {}), /listen failed/);

  const invalidAddressGateway = new RunnerSidechannelGateway(
    { ingestEvent: () => {} },
    {
      createServer: (handler) =>
        ({
          once: () => {},
          listen: (_port: number, _host: string, callback: () => void) => callback(),
          address: () => null,
          close: (callback: () => void) => callback(),
        }) as any,
    }
  );

  await assert.rejects(() => invalidAddressGateway.injectEnv('term-addr', {}), /Invalid sidechannel server address/);
});
