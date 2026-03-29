import test from 'node:test';
import assert from 'node:assert/strict';

class FakeBrowserWindow {
  static windows: FakeBrowserWindow[] = [];
  static getAllWindows(): FakeBrowserWindow[] {
    return [...FakeBrowserWindow.windows];
  }

  options: Electron.BrowserWindowConstructorOptions;
  loadedFile = '';
  handlers = new Map<string, (...args: any[]) => void>();
  sent: Array<{ channel: string; action: string }> = [];

  webContents = {
    send: (channel: string, action: string) => {
      this.sent.push({ channel, action });
    },
  };

  constructor(options: Electron.BrowserWindowConstructorOptions) {
    this.options = options;
    FakeBrowserWindow.windows.push(this);
  }

  loadFile(filePath: string): void {
    this.loadedFile = filePath;
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.handlers.set(event, listener);
  }

  emit(event: string, ...args: any[]): void {
    this.handlers.get(event)?.(...args);
  }
}

test('recoverFromElectronRunAsNode no-ops when electron runtime has app object', async () => {
  (globalThis as any).__MC_DISABLE_AUTO_INIT__ = true;
  const mod = await import('../index.js');

  let spawned = 0;
  let exited = 0;
  mod.recoverFromElectronRunAsNode({
    requireElectron: () => ({ app: {} as any }),
    spawnProcess: () => { spawned += 1; },
    exitProcess: () => { exited += 1; },
  } as any);

  assert.equal(spawned, 0);
  assert.equal(exited, 0);
});

test('recoverFromElectronRunAsNode respawns electron binary and clears run-as-node env', async () => {
  (globalThis as any).__MC_DISABLE_AUTO_INIT__ = true;
  const mod = await import('../index.js');

  let spawnCall: { file: string; args: string[]; options: Record<string, unknown> } | null = null;
  let exitCode = -1;
  mod.recoverFromElectronRunAsNode({
    requireElectron: () => '/mock/electron',
    env: () => ({ ELECTRON_RUN_AS_NODE: '1', KEEP: 'yes' }),
    argv: () => ['node', 'entry.js', '--flag'],
    cwd: () => '/repo',
    spawnProcess: (file: string, args: string[], options: Record<string, unknown>) => {
      spawnCall = { file, args, options };
    },
    exitProcess: (code: number) => {
      exitCode = code;
    },
  } as any);

  assert.equal(spawnCall?.file, '/mock/electron');
  assert.deepEqual(spawnCall?.args, ['entry.js', '--flag']);
  assert.equal((spawnCall?.options.env as Record<string, string>).ELECTRON_RUN_AS_NODE, undefined);
  assert.equal((spawnCall?.options.env as Record<string, string>).KEEP, 'yes');
  assert.equal(exitCode, 0);
});

test('recoverFromElectronRunAsNode throws actionable error when binary cannot be resolved', async () => {
  (globalThis as any).__MC_DISABLE_AUTO_INIT__ = true;
  const mod = await import('../index.js');

  assert.throws(
    () => mod.recoverFromElectronRunAsNode({
      requireElectron: () => ({}) as any,
      spawnProcess: () => {},
      exitProcess: () => {},
    } as any),
    /Electron is running in Node mode/
  );
});

test('createMainWindow wires BrowserWindow options and swipe handlers', async () => {
  (globalThis as any).__MC_DISABLE_AUTO_INIT__ = true;
  const mod = await import('../index.js');
  FakeBrowserWindow.windows = [];

  const win = mod.createMainWindow({
    platform: () => 'darwin',
    requireElectron: () => ({
      BrowserWindow: FakeBrowserWindow as unknown as Electron.BrowserWindowConstructor,
      app: {} as any,
    }),
  } as any) as unknown as FakeBrowserWindow;

  assert.equal(win.options.title, 'MultiClaude');
  assert.equal(win.options.titleBarStyle, 'hiddenInset');
  assert.match(win.loadedFile, /renderer[\/\\]index\.html$/);

  win.emit('swipe', {}, 'left');
  win.emit('swipe', {}, 'right');
  assert.deepEqual(win.sent.map((item) => item.action), ['next-tab', 'prev-tab']);

  win.emit('closed');
  assert.equal(FakeBrowserWindow.getAllWindows().length, 1);
});

test('initializeMainProcess wires lifecycle hooks and startup sequence', async () => {
  (globalThis as any).__MC_DISABLE_AUTO_INIT__ = true;
  const mod = await import('../index.js');
  FakeBrowserWindow.windows = [];

  const appHandlers = new Map<string, (...args: any[]) => void>();
  let appName = '';
  let dockBadge = 'unset';
  let quitCount = 0;
  let registered = 0;
  let menuCreated = 0;
  let killed = 0;

  const fakeApp = {
    setName: (name: string) => { appName = name; },
    dock: { setBadge: (text: string) => { dockBadge = text; } },
    whenReady: async () => {},
    on: (event: string, listener: (...args: any[]) => void) => {
      appHandlers.set(event, listener);
    },
    quit: () => { quitCount += 1; },
  };

  mod.initializeMainProcess({
    platform: () => 'linux',
    requireElectron: () => ({
      app: fakeApp as any,
      BrowserWindow: FakeBrowserWindow as unknown as Electron.BrowserWindowConstructor,
    }),
    registerIpcHandlers: () => { registered += 1; },
    createAppMenu: () => { menuCreated += 1; },
    killAllPtys: () => { killed += 1; },
  } as any);

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(appName, 'MultiClaude');
  assert.equal(dockBadge, 'unset');
  assert.equal(registered, 1);
  assert.equal(menuCreated, 1);
  assert.equal(FakeBrowserWindow.getAllWindows().length, 1);

  appHandlers.get('activate')?.();
  assert.equal(FakeBrowserWindow.getAllWindows().length, 1);
  FakeBrowserWindow.windows = [];
  appHandlers.get('activate')?.();
  assert.equal(FakeBrowserWindow.getAllWindows().length, 1);

  appHandlers.get('window-all-closed')?.();
  appHandlers.get('before-quit')?.();
  assert.equal(killed, 2);
  assert.equal(quitCount, 1);
});
