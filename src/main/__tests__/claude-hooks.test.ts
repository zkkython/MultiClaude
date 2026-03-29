import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  __setClaudeHooksDepsForTest,
  ensureHookEntry,
  ensureRecord,
  getClaudeHooksStatus,
  hasHookEntry,
  installClaudeHooksConfig,
  quoteShellArg,
  readClaudeSettingsObject,
} from '../claude-hooks.js';

test.afterEach(() => {
  __setClaudeHooksDepsForTest(null);
});

test('quoteShellArg escapes single quotes safely', () => {
  assert.equal(quoteShellArg("a'b"), `'a'\\''b'`);
  assert.equal(quoteShellArg('plain'), `'plain'`);
});

test('ensureRecord returns existing object or initializes missing key', () => {
  const parent: Record<string, unknown> = { hooks: { a: 1 } };
  const existing = ensureRecord(parent, 'hooks');
  assert.deepEqual(existing, { a: 1 });

  const created = ensureRecord(parent, 'missing');
  assert.deepEqual(created, {});
  assert.equal(typeof parent.missing, 'object');
});

test('ensureHookEntry and hasHookEntry manage command hook entries', () => {
  const hooks: Record<string, unknown> = {};
  const command = `node '/tmp/hook.js'`;

  ensureHookEntry(hooks, 'Stop', command);
  assert.equal(hasHookEntry(hooks, 'Stop', command), true);

  ensureHookEntry(hooks, 'Stop', command);
  const stopEntries = hooks.Stop as Array<Record<string, unknown>>;
  assert.equal(stopEntries.length, 1);

  ensureHookEntry(hooks, 'PreToolUse', command);
  const preToolEntry = (hooks.PreToolUse as Array<Record<string, unknown>>)[0];
  assert.equal(preToolEntry.matcher, '*');
});

test('readClaudeSettingsObject handles missing, empty, valid and invalid files', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-settings-'));
  const missing = path.join(tmp, 'missing.json');
  const empty = path.join(tmp, 'empty.json');
  const valid = path.join(tmp, 'valid.json');
  const invalid = path.join(tmp, 'invalid.json');
  const notObject = path.join(tmp, 'array.json');

  await fs.writeFile(empty, '   ', 'utf8');
  await fs.writeFile(valid, '{"hooks":{"x":[]}}', 'utf8');
  await fs.writeFile(invalid, '{', 'utf8');
  await fs.writeFile(notObject, '[]', 'utf8');

  assert.deepEqual(await readClaudeSettingsObject(missing), {});
  assert.deepEqual(await readClaudeSettingsObject(empty), {});
  assert.deepEqual(await readClaudeSettingsObject(valid), { hooks: { x: [] } });
  await assert.rejects(() => readClaudeSettingsObject(invalid));
  await assert.rejects(() => readClaudeSettingsObject(notObject), /Invalid settings root/);
});

test('installClaudeHooksConfig writes hooks and getClaudeHooksStatus reports installed', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-hooks-'));
  const fakeHome = path.join(tmp, 'home');
  const fakeCwd = path.join(tmp, 'repo');
  const fakeResources = path.join(tmp, 'resources');
  const hookScript = path.join(fakeCwd, 'scripts/hooks/claude-runner-sidechannel.js');
  await fs.mkdir(path.dirname(hookScript), { recursive: true });
  await fs.writeFile(hookScript, 'console.log("hook")\n', 'utf8');

  __setClaudeHooksDepsForTest({
    homedir: () => fakeHome,
    cwd: () => fakeCwd,
    resourcesPath: () => fakeResources,
  });

  await installClaudeHooksConfig();
  const status = await getClaudeHooksStatus();
  assert.equal(status.installed, true);
  assert.equal(status.missingEvents.length, 0);
  assert.match(status.settingsPath, /[\/\\]\.claude[\/\\]settings\.json$/);
});
