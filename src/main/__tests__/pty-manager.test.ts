import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __setPtyManagerDepsForTest,
  killAllPtys,
  killPty,
  resizePty,
  spawnPty,
  writePty,
} from '../pty-manager.js';

type ExitHandler = (exitData: { exitCode: number; signal?: number }) => void;

function createFakePtyProcess(options?: { throwOnKill?: boolean }) {
  let onDataHandler: ((data: string) => void) | null = null;
  let onExitHandler: ExitHandler | null = null;
  const writes: string[] = [];
  const resizes: Array<{ cols: number; rows: number }> = [];
  let killCount = 0;

  return {
    pid: 1234,
    writes,
    resizes,
    get killCount() {
      return killCount;
    },
    onData(callback: (data: string) => void) {
      onDataHandler = callback;
    },
    onExit(callback: ExitHandler) {
      onExitHandler = callback;
    },
    write(data: string) {
      writes.push(data);
    },
    resize(cols: number, rows: number) {
      resizes.push({ cols, rows });
    },
    kill() {
      killCount += 1;
      if (options?.throwOnKill) {
        throw new Error('kill failed');
      }
    },
    emitData(data: string) {
      onDataHandler?.(data);
    },
    emitExit(code: number) {
      onExitHandler?.({ exitCode: code });
    },
  };
}

test.afterEach(() => {
  killAllPtys();
  __setPtyManagerDepsForTest(null);
});

test('spawnPty sanitizes env, retries shell candidates, and wires io lifecycle', () => {
  const spawnCalls: Array<{ shell: string; args: string[]; options: Record<string, unknown> }> = [];
  const fakeProc = createFakePtyProcess();
  const dataEvents: string[] = [];
  const exitCodes: number[] = [];
  let attempt = 0;

  __setPtyManagerDepsForTest({
    platform: () => 'linux',
    env: () => ({ SHELL: '/custom-shell' }),
    homedir: () => '/home/tester',
    existsSync: (targetPath) => targetPath === '/bin/zsh' || targetPath === '/bin/bash',
    requireResolve: () => {
      throw new Error('node-pty package path not available');
    },
    runtimeRequire: () => ({
      spawn: (shell: string, args: string[], options: Record<string, unknown>) => {
        spawnCalls.push({ shell, args, options });
        attempt += 1;
        if (attempt === 1) throw new Error('first candidate failed');
        return fakeProc;
      },
    }),
  });

  spawnPty(
    'term-1',
    {
      VALID_KEY: 'value',
      INVALID_KEY: 'ok',
      'BAD=KEY': 'skip',
      '2BAD': 'skip',
      NULL_CHAR: 'a\u0000b',
    },
    (chunk) => dataEvents.push(chunk),
    (code) => exitCodes.push(code),
  );

  assert.equal(spawnCalls.length, 2);
  assert.equal(spawnCalls[0].shell, '/bin/zsh');
  assert.deepEqual(spawnCalls[0].args, ['-il']);
  assert.equal(spawnCalls[1].shell, '/bin/bash');
  assert.deepEqual(spawnCalls[1].args, ['-il']);
  assert.equal(spawnCalls[1].options.cwd, '/home/tester');
  assert.deepEqual(spawnCalls[1].options.env, {
    VALID_KEY: 'value',
    INVALID_KEY: 'ok',
    NULL_CHAR: 'ab',
  });

  writePty('term-1', 'echo hi');
  resizePty('term-1', 120, 40);
  fakeProc.emitData('chunk-1');
  fakeProc.emitExit(7);

  assert.deepEqual(fakeProc.writes, ['echo hi']);
  assert.deepEqual(fakeProc.resizes, [{ cols: 120, rows: 40 }]);
  assert.deepEqual(dataEvents, ['chunk-1']);
  assert.deepEqual(exitCodes, [7]);

  // after onExit terminal is removed
  writePty('term-1', 'ignored');
  assert.deepEqual(fakeProc.writes, ['echo hi']);
});

test('spawnPty throws when no shell candidates are available', () => {
  __setPtyManagerDepsForTest({
    platform: () => 'linux',
    env: () => ({ SHELL: '/missing-shell' }),
    existsSync: () => false,
    requireResolve: () => {
      throw new Error('node-pty package path not available');
    },
    runtimeRequire: () => ({ spawn: () => createFakePtyProcess() }),
  });

  assert.throws(
    () => spawnPty('term-none', {}, () => {}, () => {}),
    /No available shell candidates for PTY spawn/
  );
});

test('spawnPty on windows uses empty shell args and honors explicit cwd', () => {
  const spawnCalls: Array<{ shell: string; args: string[]; options: Record<string, unknown> }> = [];
  const fakeProc = createFakePtyProcess();

  __setPtyManagerDepsForTest({
    platform: () => 'win32',
    env: () => ({ COMSPEC: 'pwsh.exe' }),
    homedir: () => 'C:/Users/tester',
    requireResolve: () => {
      throw new Error('node-pty package path not available');
    },
    runtimeRequire: () => ({
      spawn: (shell: string, args: string[], options: Record<string, unknown>) => {
        spawnCalls.push({ shell, args, options });
        return fakeProc;
      },
    }),
  });

  spawnPty('term-win', { PATH: 'C:/Windows/System32' }, () => {}, () => {}, { cwd: 'D:/repo' });
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].shell, 'pwsh.exe');
  assert.deepEqual(spawnCalls[0].args, []);
  assert.equal(spawnCalls[0].options.cwd, 'D:/repo');
});

test('killPty and killAllPtys are best effort during cleanup', () => {
  const procA = createFakePtyProcess();
  const procB = createFakePtyProcess({ throwOnKill: true });
  let spawnCount = 0;

  __setPtyManagerDepsForTest({
    platform: () => 'win32',
    env: () => ({ COMSPEC: 'cmd.exe' }),
    requireResolve: () => {
      throw new Error('node-pty package path not available');
    },
    runtimeRequire: () => ({
      spawn: () => {
        spawnCount += 1;
        return spawnCount === 1 ? procA : procB;
      },
    }),
  });

  spawnPty('term-a', {}, () => {}, () => {});
  spawnPty('term-b', {}, () => {}, () => {});

  killPty('term-a');
  assert.equal(procA.killCount, 1);
  killPty('missing-term');
  assert.equal(procA.killCount, 1);

  killAllPtys();
  assert.equal(procB.killCount, 1);
});

test('spawn helper executable mode is fixed when helper lacks execute bits', () => {
  const chmodCalls: Array<{ targetPath: string; mode: number }> = [];

  __setPtyManagerDepsForTest({
    platform: () => 'darwin',
    requireResolve: () => '/pkg/node-pty/package.json',
    statSync: () => ({ mode: 0o644 }),
    chmodSync: (targetPath, mode) => chmodCalls.push({ targetPath, mode }),
    runtimeRequire: () => ({ spawn: () => createFakePtyProcess() }),
  });

  spawnPty('term-darwin', {}, () => {}, () => {});

  assert.equal(chmodCalls.length, 2);
  assert.equal(chmodCalls[0].targetPath, `/pkg/node-pty/prebuilds/darwin-${process.arch}/spawn-helper`);
  assert.equal(chmodCalls[0].mode, 0o755);
  assert.equal(chmodCalls[1].targetPath, '/pkg/node-pty/build/Release/spawn-helper');
  assert.equal(chmodCalls[1].mode, 0o755);
});
