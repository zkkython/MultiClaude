import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __setUserDataPathResolverForTest,
  getCodexHomePath,
  getCodexHomesDir,
  getEnvFilePath,
  getEnvFilesDir,
  getZdotdirPath,
} from '../config-paths.js';

test.afterEach(() => {
  __setUserDataPathResolverForTest(null);
});

test('config path helpers resolve under userData path', () => {
  __setUserDataPathResolverForTest(() => '/tmp/mc-data');

  assert.equal(getEnvFilesDir(), '/tmp/mc-data/env-files');
  assert.equal(getEnvFilePath('cfg-1'), '/tmp/mc-data/env-files/cfg-1.sh');
  assert.equal(getZdotdirPath('cfg-1'), '/tmp/mc-data/env-files/zdotdir-cfg-1');
  assert.equal(getCodexHomesDir(), '/tmp/mc-data/codex-homes');
});

test('getCodexHomePath sanitizes codex home name and falls back to id', () => {
  __setUserDataPathResolverForTest(() => '/tmp/mc-data');

  const byName = getCodexHomePath({ id: 'cfg-1', codexHomeName: ' team/a\\b:c ' });
  assert.equal(byName, '/tmp/mc-data/codex-homes/team-a-b-c');

  const byId = getCodexHomePath({ id: 'cfg id', codexHomeName: '' });
  assert.equal(byId, '/tmp/mc-data/codex-homes/cfg-id');
});
