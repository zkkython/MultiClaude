import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEndpoint, runProtocolConnectivityTest } from '../protocol-connectivity.js';

test('runProtocolConnectivityTest skips checks for pty transport', async () => {
  const result = await runProtocolConnectivityTest({
    provider: 'claude',
    customEnvVars: { MC_PROTOCOL_TRANSPORT: 'pty' },
  } as any);

  assert.equal(result.ok, true);
  assert.equal(result.transportType, 'pty');
  assert.match(result.summary, /skipped/i);
  assert.equal(result.details.length, 1);
});

test('runProtocolConnectivityTest performs HTTP checks and returns failure summary', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: String(init?.method || 'GET') });
    if (url.includes('/interrupt')) {
      return { ok: false, status: 503 } as Response;
    }
    return { ok: true, status: 200 } as Response;
  }) as any;

  try {
    const result = await runProtocolConnectivityTest({
      provider: 'claude',
      anthropicBaseUrl: 'https://claude.example',
      customEnvVars: {
        MC_PROTOCOL_TRANSPORT: 'http_sse',
        MC_PROTOCOL_STREAM_URL: 'https://runner.example/stream',
        MC_PROTOCOL_INPUT_URL: 'https://runner.example/input',
        MC_PROTOCOL_INTERRUPT_URL: 'https://runner.example/interrupt',
        MC_PROTOCOL_STOP_URL: 'https://runner.example/stop',
        MC_PROTOCOL_AUTH_HEADER: 'authorization',
        MC_PROTOCOL_AUTH_TOKEN: 'Bearer token-1',
      },
    } as any);

    assert.equal(result.transportType, 'http_sse');
    assert.equal(result.ok, false);
    assert.match(result.summary, /failed/i);
    assert.equal(result.details.length, 4);
    assert.deepEqual(calls.map((item) => item.method), ['GET', 'POST', 'POST', 'POST']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('checkEndpoint handles missing url, non-ok status, and fetch errors', async () => {
  const missing = await checkEndpoint('stream', '', 'GET', {});
  assert.equal(missing.ok, false);
  assert.equal(missing.message, 'Missing URL');

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => ({ ok: false, status: 401 } as Response)) as any;
    const unauthorized = await checkEndpoint('input', 'https://x/input', 'POST', {}, { x: 1 });
    assert.equal(unauthorized.ok, false);
    assert.equal(unauthorized.status, 401);

    globalThis.fetch = (async () => { throw new Error('network down'); }) as any;
    const failed = await checkEndpoint('stop', 'https://x/stop', 'POST', {});
    assert.equal(failed.ok, false);
    assert.match(failed.message, /network down/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
