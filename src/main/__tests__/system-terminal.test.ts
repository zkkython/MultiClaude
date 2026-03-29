import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { __setSystemTerminalDepsForTest, openSystemTerminal } from '../system-terminal.js';
import type { ModelConfig } from '../../shared/types.js';

class FakeChild extends EventEmitter {
  unrefCalled = false;
  unref(): void {
    this.unrefCalled = true;
  }
}

function makeConfig(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'cfg-1',
    name: 'My "Config"',
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
  __setSystemTerminalDepsForTest(null);
});

test('openSystemTerminal on mac uses osascript and escapes command payload', async () => {
  const spawnCalls: Array<{ cmd: string; args: string[]; cwd?: string }> = [];
  __setSystemTerminalDepsForTest({
    getPlatform: () => 'darwin',
    buildEnvForConfig: () => ({ MULTICLAUDE_ENV_FILE: "/tmp/a'b.sh" }),
    ensureCodexApiKeyLogin: async () => {},
    spawn: ((cmd: string, args: string[], opts: any) => {
      spawnCalls.push({ cmd, args, cwd: opts?.cwd });
      const child = new FakeChild();
      queueMicrotask(() => child.emit('spawn'));
      return child as any;
    }) as any,
  });

  await openSystemTerminal(makeConfig(), { cwd: "/work/o'hara" });
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].cmd, 'osascript');
  assert.equal(spawnCalls[0].args[0], '-e');
  assert.match(spawnCalls[0].args[1], /source '\/tmp\/a'.*b\.sh'/);
  assert.match(spawnCalls[0].args[1], /cd '\/work\/o'.*hara' &&/);
});

test('openSystemTerminal on mac no-ops when env file is missing', async () => {
  let spawnCount = 0;
  __setSystemTerminalDepsForTest({
    getPlatform: () => 'darwin',
    buildEnvForConfig: () => ({}),
    ensureCodexApiKeyLogin: async () => {},
    spawn: (() => {
      spawnCount += 1;
      const child = new FakeChild();
      queueMicrotask(() => child.emit('spawn'));
      return child as any;
    }) as any,
  });

  await openSystemTerminal(makeConfig());
  assert.equal(spawnCount, 0);
});

test('openSystemTerminal on windows falls back to next terminal candidate', async () => {
  const attempts: string[] = [];
  __setSystemTerminalDepsForTest({
    getPlatform: () => 'win32',
    buildEnvForConfig: () => ({ SOME: 'ENV' }),
    ensureCodexApiKeyLogin: async () => {},
    spawn: ((cmd: string) => {
      attempts.push(cmd);
      const child = new FakeChild();
      queueMicrotask(() => {
        if (cmd === 'wt.exe') child.emit('error', new Error('not found'));
        else child.emit('spawn');
      });
      return child as any;
    }) as any,
  });

  await openSystemTerminal(makeConfig());
  assert.deepEqual(attempts.slice(0, 2), ['wt.exe', 'cmd.exe']);
});

test('openSystemTerminal on linux throws when all terminal candidates fail', async () => {
  __setSystemTerminalDepsForTest({
    getPlatform: () => 'linux',
    buildEnvForConfig: () => ({ SOME: 'ENV' }),
    ensureCodexApiKeyLogin: async () => {},
    spawn: (() => {
      const child = new FakeChild();
      queueMicrotask(() => child.emit('error', new Error('missing')));
      return child as any;
    }) as any,
  });

  await assert.rejects(() => openSystemTerminal(makeConfig()), /missing/);
});
