import test from 'node:test';
import assert from 'node:assert/strict';
import type { ModelConfig } from '../../shared/types.js';
import { collectPreflightIssues } from '../preflight.js';

function makeBaseConfig(provider: 'claude' | 'codex'): ModelConfig {
  return {
    id: 'cfg-1',
    name: 'Config 1',
    color: '#4A90D9',
    provider,
    anthropicBaseUrl: '',
    anthropicAuthToken: '',
    apiTimeoutMs: 60_000,
    anthropicModel: '',
    anthropicSmallFastModel: '',
    disableNonessentialTraffic: false,
    openaiBaseUrl: '',
    openaiApiKey: '',
    openaiModel: '',
    codexHomeMode: 'isolated',
    codexHomeName: 'codex-home',
    codexModelProvider: 'openai',
    codexApiKeyEnvKey: 'OPENAI_API_KEY',
    codexPersonality: 'pragmatic',
    codexModelReasoningEffort: 'medium',
    codexWireApi: 'responses',
    customEnvVars: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sortOrder: 0,
  };
}

test('codex preflight blocks missing model and key', () => {
  const result = collectPreflightIssues(makeBaseConfig('codex'));
  assert.equal(result.blockers.includes('Missing OPENAI model.'), true);
  assert.equal(result.blockers.some(item => item.startsWith('Missing API key')), true);
});

test('claude preflight warns when hooks are missing', () => {
  const cfg = makeBaseConfig('claude');
  cfg.anthropicModel = 'claude-opus-4-1';
  cfg.anthropicAuthToken = 'sk-ant-1';
  const result = collectPreflightIssues(cfg, {
    claudeHooksStatus: {
      installed: false,
      settingsPath: '/tmp/settings.json',
      hookScriptPath: '/tmp/hook.js',
      command: 'node hook.js',
      missingEvents: ['Notification'],
    },
  });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.warnings.some(item => item.includes('Claude hooks are not fully installed')), true);
});

test('http_sse preflight blocks invalid headers json', () => {
  const cfg = makeBaseConfig('codex');
  cfg.openaiModel = 'gpt-5-codex';
  cfg.openaiApiKey = 'sk-1';
  cfg.customEnvVars.MC_PROTOCOL_TRANSPORT = 'http_sse';
  cfg.customEnvVars.MC_PROTOCOL_HEADERS_JSON = '{invalid_json';
  const result = collectPreflightIssues(cfg);
  assert.equal(result.blockers.includes('MC_PROTOCOL_HEADERS_JSON is not valid JSON.'), true);
});

test('unknown transport emits warning', () => {
  const cfg = makeBaseConfig('codex');
  cfg.openaiModel = 'gpt-5-codex';
  cfg.openaiApiKey = 'sk-1';
  cfg.customEnvVars.MC_PROTOCOL_TRANSPORT = 'foo_bar';
  const result = collectPreflightIssues(cfg);
  assert.equal(result.warnings.some(item => item.includes('Unknown MC_PROTOCOL_TRANSPORT')), true);
});
