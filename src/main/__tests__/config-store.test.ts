import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  __setConfigStoreDepsForTest,
  deleteConfig,
  exportConfigs,
  getAllConfigs,
  getSettings,
  importConfigs,
  saveSettings,
} from '../config-store.js';
import type { ModelConfig } from '../../shared/types.js';

class MemoryFs {
  files = new Map<string, string>();
  dirs = new Set<string>();
  rmCalls: string[] = [];

  existsSync = (p: any): boolean => {
    const filePath = String(p);
    return this.files.has(filePath) || this.dirs.has(filePath);
  };

  readFileSync = (p: any): string => {
    const filePath = String(p);
    if (!this.files.has(filePath)) throw new Error(`ENOENT: ${filePath}`);
    return this.files.get(filePath)!;
  };

  writeFileSync = (p: any, data: string | NodeJS.ArrayBufferView): void => {
    const filePath = String(p);
    this.files.set(filePath, String(data));
    this.dirs.add(path.dirname(filePath));
  };

  mkdirSync = (p: any): string | undefined => {
    this.dirs.add(String(p));
    return undefined;
  };

  rmSync = (p: any, opts?: { recursive?: boolean; force?: boolean }): void => {
    const target = String(p);
    this.rmCalls.push(target);
    this.files.delete(target);
    if (opts?.recursive) {
      for (const key of Array.from(this.files.keys())) {
        if (key.startsWith(`${target}/`)) this.files.delete(key);
      }
      for (const dir of Array.from(this.dirs.values())) {
        if (dir === target || dir.startsWith(`${target}/`)) this.dirs.delete(dir);
      }
    }
  };
}

function installDeps(mem: MemoryFs): void {
  __setConfigStoreDepsForTest({
    appGetPath: () => '/appdata',
    fs: {
      existsSync: mem.existsSync as any,
      readFileSync: mem.readFileSync as any,
      writeFileSync: mem.writeFileSync as any,
      mkdirSync: mem.mkdirSync as any,
      rmSync: mem.rmSync as any,
    },
    paths: {
      getEnvFilePath: (configId: string) => `/env-files/${configId}.sh`,
      getZdotdirPath: (configId: string) => `/env-files/zdotdir-${configId}`,
      getCodexHomePath: (config: Pick<ModelConfig, 'id' | 'codexHomeName'>) => `/codex-homes/${config.codexHomeName || config.id}`,
    },
    nowIso: () => '2026-03-29T00:00:00.000Z',
  });
}

test.afterEach(() => {
  __setConfigStoreDepsForTest(null);
});

test('getAllConfigs migrates v1 array format and writes backup', () => {
  const mem = new MemoryFs();
  installDeps(mem);
  const configPath = '/appdata/configs.json';
  mem.files.set(configPath, JSON.stringify([
    {
      id: 'cfg-1',
      name: 'Legacy Claude',
      anthropicModel: 'claude-4',
      provider: 'claude',
      color: '#4A90D9',
    },
  ]));

  const configs = getAllConfigs();
  assert.equal(configs.length, 1);
  assert.equal(configs[0].name, 'Legacy Claude');

  const backup = mem.files.get('/appdata/configs.v1.backup.json');
  assert.ok(backup);
  const migratedText = mem.files.get('/appdata/configs.json');
  assert.ok(migratedText);
  const migrated = JSON.parse(migratedText!);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(Array.isArray(migrated.configs), true);
});

test('deleteConfig removes config and artifacts for codex profile', () => {
  const mem = new MemoryFs();
  installDeps(mem);
  mem.files.set('/appdata/configs.json', JSON.stringify({
    schemaVersion: 2,
    configs: [
      {
        id: 'cfg-codex',
        name: 'Codex A',
        color: '#4A90D9',
        provider: 'codex',
        anthropicBaseUrl: '',
        anthropicAuthToken: '',
        apiTimeoutMs: 600000,
        anthropicModel: '',
        anthropicSmallFastModel: '',
        disableNonessentialTraffic: false,
        openaiBaseUrl: '',
        openaiApiKey: '',
        openaiModel: 'gpt-4.1',
        codexHomeMode: 'isolated',
        codexHomeName: 'home-a',
        codexModelProvider: 'openai',
        codexApiKeyEnvKey: 'OPENAI_API_KEY',
        codexPersonality: 'pragmatic',
        codexModelReasoningEffort: 'medium',
        codexWireApi: 'responses',
        customEnvVars: {},
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:00.000Z',
        sortOrder: 0,
      },
    ],
  }));

  deleteConfig('cfg-codex');
  assert.deepEqual(mem.rmCalls, [
    '/env-files/cfg-codex.sh',
    '/env-files/zdotdir-cfg-codex',
    '/codex-homes/home-a',
  ]);
  const saved = JSON.parse(mem.files.get('/appdata/configs.json')!);
  assert.equal(saved.configs.length, 0);
});

test('export/import configs redact secrets and rename duplicates', async () => {
  const mem = new MemoryFs();
  installDeps(mem);
  mem.files.set('/appdata/configs.json', JSON.stringify({
    schemaVersion: 2,
    configs: [
      {
        id: 'cfg-1',
        name: 'Team',
        color: '#4A90D9',
        provider: 'codex',
        anthropicBaseUrl: '',
        anthropicAuthToken: 'secret-a',
        apiTimeoutMs: 600000,
        anthropicModel: '',
        anthropicSmallFastModel: '',
        disableNonessentialTraffic: false,
        openaiBaseUrl: '',
        openaiApiKey: 'secret-b',
        openaiModel: 'gpt-4.1',
        codexHomeMode: 'isolated',
        codexHomeName: '',
        codexModelProvider: 'openai',
        codexApiKeyEnvKey: 'OPENAI_API_KEY',
        codexPersonality: 'pragmatic',
        codexModelReasoningEffort: 'medium',
        codexWireApi: 'responses',
        customEnvVars: {},
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:00.000Z',
        sortOrder: 0,
      },
    ],
  }));

  const ok = await exportConfigs('/tmp/export.json');
  assert.equal(ok, true);
  const exported = JSON.parse(mem.files.get('/tmp/export.json')!);
  assert.equal(exported.configs[0].anthropicAuthToken, '');
  assert.equal(exported.configs[0].openaiApiKey, '');

  mem.files.set('/tmp/import.json', JSON.stringify({
    configs: [
      {
        id: 'will-be-replaced',
        name: 'Team',
        color: '#4A90D9',
        provider: 'codex',
        openaiModel: 'gpt-4.1-mini',
        customEnvVars: { GOOD_KEY: '1', 'bad-key': 'x' },
      },
      {
        id: 'invalid',
        name: 'Bad Claude',
        color: '#4A90D9',
        provider: 'claude',
        anthropicModel: '',
      },
    ],
  }));

  const result = await importConfigs('/tmp/import.json');
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.errors.some((e) => e.includes('invalid environment variable names')), true);

  const saved = JSON.parse(mem.files.get('/appdata/configs.json')!);
  const names = saved.configs.map((c: any) => c.name);
  assert.equal(names.includes('Team'), true);
  assert.equal(names.includes('Team (2)'), true);
});

test('getSettings/saveSettings use defaults and merge updates', () => {
  const mem = new MemoryFs();
  installDeps(mem);

  const defaults = getSettings();
  assert.equal(defaults.sidebarWidth > 0, true);
  assert.deepEqual(defaults.groups, []);
  assert.equal(defaults.useWebglRenderer, false);

  saveSettings({ sidebarWidth: 420, useWebglRenderer: true });
  const next = getSettings();
  assert.equal(next.sidebarWidth, 420);
  assert.equal(next.useWebglRenderer, true);
  assert.equal(next.worktreeDefaultTargetRef, 'main');
});
