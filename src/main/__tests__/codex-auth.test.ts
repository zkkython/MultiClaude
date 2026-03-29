import test from 'node:test';
import assert from 'node:assert/strict';
import { __setRunCodexForTest, ensureCodexApiKeyLogin } from '../codex-auth.js';
import type { ModelConfig } from '../../shared/types.js';

function makeCodexConfig(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'cfg-1',
    name: 'Codex',
    color: '#111111',
    provider: 'codex',
    anthropicBaseUrl: '',
    anthropicAuthToken: '',
    apiTimeoutMs: 0,
    anthropicModel: '',
    anthropicSmallFastModel: '',
    disableNonessentialTraffic: false,
    openaiBaseUrl: '',
    openaiApiKey: '',
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

test.afterEach(() => {
  __setRunCodexForTest(null);
});

test('skips when provider is not codex/openai or api key is missing', async () => {
  const calls: string[] = [];
  __setRunCodexForTest(async (args) => {
    calls.push(args.join(' '));
    return { code: 0, stdout: 'Logged in', stderr: '', notFound: false, timedOut: false };
  });

  await ensureCodexApiKeyLogin(makeCodexConfig({ provider: 'claude' }), { OPENAI_API_KEY: 'k' });
  await ensureCodexApiKeyLogin(makeCodexConfig({ codexModelProvider: 'azure' }), { OPENAI_API_KEY: 'k' });
  await ensureCodexApiKeyLogin(makeCodexConfig(), {});
  assert.equal(calls.length, 0);
});

test('returns when status already logged in', async () => {
  const calls: string[] = [];
  __setRunCodexForTest(async (args) => {
    calls.push(args.join(' '));
    return { code: 0, stdout: 'Logged in as test-user', stderr: '', notFound: false, timedOut: false };
  });

  await ensureCodexApiKeyLogin(makeCodexConfig(), { OPENAI_API_KEY: 'k-1' });
  assert.deepEqual(calls, ['login status']);
});

test('attempts login when status is not logged in', async () => {
  const calls: string[] = [];
  __setRunCodexForTest(async (args) => {
    calls.push(args.join(' '));
    if (args[1] === 'status') {
      return { code: 1, stdout: '', stderr: 'not logged in', notFound: false, timedOut: false };
    }
    return { code: 0, stdout: 'ok', stderr: '', notFound: false, timedOut: false };
  });

  await ensureCodexApiKeyLogin(makeCodexConfig(), { OPENAI_API_KEY: 'k-1' });
  assert.deepEqual(calls, ['login status', 'login --with-api-key']);
});

test('ignores codex command not found in status/login flows', async () => {
  __setRunCodexForTest(async (args) => {
    if (args[1] === 'status') {
      return { code: 1, stdout: '', stderr: '', notFound: true, timedOut: false };
    }
    return { code: 1, stdout: '', stderr: '', notFound: true, timedOut: false };
  });
  await ensureCodexApiKeyLogin(makeCodexConfig(), { OPENAI_API_KEY: 'k-1' });
});

test('throws actionable errors for timed out and non-zero login results', async () => {
  __setRunCodexForTest(async (args) => {
    if (args[1] === 'status') {
      return { code: 1, stdout: '', stderr: '', notFound: false, timedOut: false };
    }
    return { code: null, stdout: '', stderr: '', notFound: false, timedOut: true };
  });
  await assert.rejects(
    () => ensureCodexApiKeyLogin(makeCodexConfig(), { OPENAI_API_KEY: 'k-1' }),
    /Timed out while initializing Codex API-key login/
  );

  __setRunCodexForTest(async (args) => {
    if (args[1] === 'status') {
      return { code: 1, stdout: '', stderr: '', notFound: false, timedOut: false };
    }
    return { code: 2, stdout: '', stderr: 'invalid key', notFound: false, timedOut: false };
  });
  await assert.rejects(
    () => ensureCodexApiKeyLogin(makeCodexConfig(), { OPENAI_API_KEY: 'k-1' }),
    /invalid key/
  );
});
