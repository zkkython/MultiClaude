import test from 'node:test';
import assert from 'node:assert/strict';
import { __setEnvBuilderDepsForTest, buildEnvForConfig } from '../env-builder.js';
import type { ModelConfig } from '../../shared/types.js';

function makeConfig(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'cfg-1',
    name: 'Profile 1',
    color: '#111111',
    provider: 'claude',
    anthropicBaseUrl: '',
    anthropicAuthToken: '',
    apiTimeoutMs: 0,
    anthropicModel: '',
    anthropicSmallFastModel: '',
    disableNonessentialTraffic: false,
    openaiBaseUrl: '',
    openaiApiKey: '',
    openaiModel: '',
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

type WriteCall = { filePath: string; content: string };

function installFakeDeps(existingPaths: Set<string>) {
  const writes: WriteCall[] = [];
  const mkdirs: string[] = [];
  __setEnvBuilderDepsForTest({
    paths: {
      getEnvFilesDir: () => '/data/env-files',
      getEnvFilePath: (configId: string) => `/data/env-files/${configId}.sh`,
      getZdotdirPath: (configId: string) => `/data/env-files/zdotdir-${configId}`,
      getCodexHomePath: (config: Pick<ModelConfig, 'id' | 'codexHomeName'>) => `/data/codex/${config.codexHomeName || config.id}`,
    },
    fs: {
      existsSync: (p: any) => existingPaths.has(String(p)),
      mkdirSync: (p: any) => {
        const v = String(p);
        existingPaths.add(v);
        mkdirs.push(v);
        return undefined as unknown as string;
      },
      writeFileSync: (p: any, data: string | NodeJS.ArrayBufferView) => {
        writes.push({ filePath: String(p), content: String(data) });
      },
    },
    homedir: () => '/home/tester',
  });
  return { writes, mkdirs };
}

test.afterEach(() => {
  __setEnvBuilderDepsForTest(null);
  delete process.env.SHELL;
  delete process.env.ZDOTDIR;
});

test('buildEnvForConfig (claude) merges env with provider priority and writes zsh wrappers', () => {
  process.env.SHELL = '/bin/zsh';
  process.env.ZDOTDIR = '/real/zdotdir';
  const existing = new Set<string>();
  const { writes, mkdirs } = installFakeDeps(existing);

  const config = makeConfig({
    provider: 'claude',
    name: "Team O'Hara",
    anthropicBaseUrl: 'https://anthropic.local',
    anthropicAuthToken: 'token-1',
    anthropicModel: 'claude-4',
    anthropicSmallFastModel: 'claude-fast',
    apiTimeoutMs: 9000,
    disableNonessentialTraffic: true,
    customEnvVars: {
      ANTHROPIC_MODEL: 'wrong-model',
      CUSTOM_OK: 'yes',
      'BAD-KEY': 'ignored',
    },
  });

  const env = buildEnvForConfig(config);
  assert.equal(env.ANTHROPIC_MODEL, 'claude-4');
  assert.equal(env.CUSTOM_OK, 'yes');
  assert.equal(env['BAD-KEY'], undefined);
  assert.equal(env.MULTICLAUDE_PROVIDER, 'claude');
  assert.equal(env.MULTICLAUDE_CONFIG_NAME, "Team O'Hara");
  assert.equal(env.MULTICLAUDE_ENV_FILE, '/data/env-files/cfg-1.sh');
  assert.equal(env.CLAUDE_ENV_FILE, '/data/env-files/cfg-1.sh');
  assert.equal(env.ZDOTDIR, '/data/env-files/zdotdir-cfg-1');
  assert.equal(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');

  assert.deepEqual(mkdirs, ['/data/env-files', '/data/env-files/zdotdir-cfg-1']);
  const envFile = writes.find((w) => w.filePath === '/data/env-files/cfg-1.sh');
  assert.ok(envFile);
  assert.match(envFile!.content, /MultiClaude env for: Team O'Hara/);
  assert.match(envFile!.content, /export CUSTOM_OK='yes'/);

  const zshrc = writes.find((w) => w.filePath === '/data/env-files/zdotdir-cfg-1/.zshrc');
  assert.ok(zshrc);
  assert.match(zshrc!.content, /source '\/real\/zdotdir'\/\.zshrc/);
});

test('buildEnvForConfig (codex) normalizes env key, writes CODEX_HOME and config.toml', () => {
  process.env.SHELL = '/bin/bash';
  process.env.ZDOTDIR = '/keep-zdotdir';
  const existing = new Set<string>(['/data/env-files']);
  const { writes, mkdirs } = installFakeDeps(existing);

  const config = makeConfig({
    provider: 'codex',
    openaiBaseUrl: 'https://api.openai.local/v1',
    openaiApiKey: 'sk-test',
    openaiModel: 'gpt-4.1-mini',
    codexApiKeyEnvKey: 'MY-API-KEY',
    codexHomeName: 'team-1',
    codexModelProvider: 'openai',
    codexWireApi: 'responses' as any,
    customEnvVars: {
      CODEX_WIRE_API: 'chat_completions',
    },
  });

  const env = buildEnvForConfig(config);
  assert.equal(env.MY_API_KEY, 'sk-test');
  assert.equal(env.OPENAI_API_KEY, 'sk-test');
  assert.equal(env.CODEX_HOME, '/data/codex/team-1');
  assert.equal(env.MULTICLAUDE_PROVIDER, 'codex');
  assert.equal(env.ZDOTDIR, '/keep-zdotdir');

  assert.deepEqual(mkdirs, ['/data/codex/team-1']);

  const toml = writes.find((w) => w.filePath === '/data/codex/team-1/config.toml');
  assert.ok(toml);
  assert.match(toml!.content, /wire_api = "responses"/);
  assert.match(toml!.content, /env_key = "MY_API_KEY"/);
  assert.match(toml!.content, /model = "gpt-4.1-mini"/);
});
