import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSessionTransport,
  inferHttpSseDefaults,
  inferHttpSseDefaultsFromInput,
} from '../runner-transport-factory.js';
import type { ModelConfig } from '../../shared/types.js';

function makeConfig(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'cfg-1',
    name: 'Cfg',
    color: '#111111',
    provider: 'codex',
    anthropicBaseUrl: '',
    anthropicAuthToken: '',
    apiTimeoutMs: 0,
    anthropicModel: '',
    anthropicSmallFastModel: '',
    disableNonessentialTraffic: false,
    openaiBaseUrl: 'https://api.openai.com',
    openaiApiKey: 'sk-default',
    openaiModel: 'gpt-4.1',
    codexHomeMode: 'isolated',
    codexHomeName: '',
    codexModelProvider: 'openai',
    codexApiKeyEnvKey: 'OPENAI_API_KEY',
    codexPersonality: '',
    codexModelReasoningEffort: '',
    codexWireApi: 'responses',
    customEnvVars: {},
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    sortOrder: 0,
    ...overrides,
  };
}

test('inferHttpSseDefaults infers provider-specific urls and auth headers', () => {
  const claude = inferHttpSseDefaults(makeConfig({
    provider: 'claude',
    anthropicBaseUrl: 'https://claude.local/',
    anthropicAuthToken: 'ak-1',
  }));
  assert.equal(claude.inputUrl, 'https://claude.local/v1/messages/input');
  assert.equal(claude.headers['anthropic-version'], '2023-06-01');
  assert.equal(claude.headers['x-api-key'], 'ak-1');

  const codex = inferHttpSseDefaults(makeConfig({
    provider: 'codex',
    openaiBaseUrl: 'https://openai.local/',
    openaiApiKey: 'sk-1',
  }));
  assert.equal(codex.inputUrl, 'https://openai.local/v1/responses/input');
  assert.equal(codex.headers.Authorization, 'Bearer sk-1');
});

test('inferHttpSseDefaultsFromInput mirrors provider inference', () => {
  const fromClaude = inferHttpSseDefaultsFromInput({
    provider: 'claude',
    anthropicBaseUrl: 'https://x.local/',
    anthropicAuthToken: 't',
  });
  assert.equal(fromClaude.streamUrl, 'https://x.local/v1/messages/stream');

  const fromCodex = inferHttpSseDefaultsFromInput({
    provider: 'codex',
    openaiBaseUrl: 'https://y.local/',
    openaiApiKey: 's',
  });
  assert.equal(fromCodex.streamUrl, 'https://y.local/v1/responses/stream');
});

test('createSessionTransport builds http_sse transport with header merge and reconnect parsing', () => {
  const config = makeConfig({
    provider: 'codex',
    customEnvVars: {
      MC_PROTOCOL_TRANSPORT: 'http_sse',
      MC_PROTOCOL_AUTH_HEADER: 'x-auth',
      MC_PROTOCOL_AUTH_TOKEN: 'token-123',
      MC_PROTOCOL_HEADERS_JSON: '{"x-extra":"v","x-auth":"override"}',
      MC_PROTOCOL_RECONNECT_MAX: '3',
      MC_PROTOCOL_RECONNECT_BASE_MS: '250',
    },
  });

  const { transport, transportType } = createSessionTransport(config, 'sess-1', 'term-1');
  assert.equal(transportType, 'http_sse');
  assert.equal((transport as any).reconnectMax, 3);
  assert.equal((transport as any).reconnectBaseMs, 250);
  assert.equal((transport as any).headers.Authorization, 'Bearer sk-default');
  assert.equal((transport as any).headers['x-auth'], 'override');
  assert.equal((transport as any).headers['x-extra'], 'v');
});

test('createSessionTransport falls back to pty transport when protocol transport is not http_sse', () => {
  const { transportType } = createSessionTransport(makeConfig(), 'sess-1', 'term-1');
  assert.equal(transportType, 'pty');
});
