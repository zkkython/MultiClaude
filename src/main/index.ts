import { spawn } from 'child_process';
import * as path from 'path';
import { DEFAULTS, IPC } from '../shared/constants.js';

interface MainAppLike {
  setName: (name: string) => void;
  dock?: { setBadge: (text: string) => void };
  whenReady: () => Promise<void>;
  on: (event: string, listener: (...args: any[]) => void) => void;
  quit: () => void;
}

interface BrowserWindowLike {
  loadFile: (filePath: string) => void;
  on: (event: string, listener: (...args: any[]) => void) => void;
  webContents: {
    send: (channel: string, action: string, payload?: any) => void;
  };
}

interface BrowserWindowCtorLike {
  new (options: Electron.BrowserWindowConstructorOptions): BrowserWindowLike;
  getAllWindows: () => BrowserWindowLike[];
}

interface ElectronRuntimeLike {
  app?: MainAppLike;
  BrowserWindow?: BrowserWindowCtorLike;
}

interface MainDeps {
  requireElectron: () => ElectronRuntimeLike | string;
  spawnProcess: (file: string, args: string[], options: Record<string, unknown>) => void;
  exitProcess: (code: number) => void;
  platform: () => NodeJS.Platform;
  env: () => NodeJS.ProcessEnv;
  argv: () => string[];
  cwd: () => string;
  registerIpcHandlers: () => void;
  createAppMenu: () => void;
  killAllPtys: () => void;
}

const defaultDeps: MainDeps = {
  requireElectron: () => require('electron') as ElectronRuntimeLike | string,
  spawnProcess: (file, args, options) => {
    spawn(file, args, options as any);
  },
  exitProcess: (code) => {
    process.exit(code);
  },
  platform: () => process.platform,
  env: () => process.env,
  argv: () => process.argv,
  cwd: () => process.cwd(),
  registerIpcHandlers: () => {
    const mod = require('./ipc-handlers.js') as typeof import('./ipc-handlers.js');
    mod.registerIpcHandlers();
  },
  createAppMenu: () => {
    const mod = require('./menu.js') as typeof import('./menu.js');
    mod.createAppMenu();
  },
  killAllPtys: () => {
    const mod = require('./pty-manager.js') as typeof import('./pty-manager.js');
    mod.killAllPtys();
  },
};

let mainWindow: BrowserWindowLike | null = null;

export function recoverFromElectronRunAsNode(depsInput?: Partial<MainDeps>): void {
  const deps = { ...defaultDeps, ...(depsInput || {}) };
  const electronModule = deps.requireElectron();
  const isNodeMode = typeof electronModule === 'string' || !electronModule.app;
  if (!isNodeMode) {
    return;
  }

  const electronBinary = typeof electronModule === 'string' ? electronModule : deps.requireElectron();
  if (typeof electronBinary === 'string') {
    const env = { ...deps.env() };
    delete env.ELECTRON_RUN_AS_NODE;
    deps.spawnProcess(electronBinary, deps.argv().slice(1), {
      cwd: deps.cwd(),
      stdio: 'inherit',
      env,
    });
    deps.exitProcess(0);
    return;
  }

  throw new Error(
    'Electron is running in Node mode. Please unset ELECTRON_RUN_AS_NODE and retry.',
  );
}

export function createMainWindow(depsInput?: Partial<MainDeps>): BrowserWindowLike {
  const deps = { ...defaultDeps, ...(depsInput || {}) };
  const electronModule = deps.requireElectron();
  if (typeof electronModule === 'string' || !electronModule.BrowserWindow) {
    throw new Error('BrowserWindow is unavailable');
  }

  const BrowserWindow = electronModule.BrowserWindow;
  mainWindow = new BrowserWindow({
    width: DEFAULTS.WINDOW_WIDTH,
    height: DEFAULTS.WINDOW_HEIGHT,
    minWidth: DEFAULTS.WINDOW_MIN_WIDTH,
    minHeight: DEFAULTS.WINDOW_MIN_HEIGHT,
    title: 'MultiClaude',
    titleBarStyle: deps.platform() === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('swipe', (_event: Electron.Event, direction: string) => {
    if (direction === 'left') {
      mainWindow?.webContents.send(IPC.MENU_ACTION, 'next-tab');
    } else if (direction === 'right') {
      mainWindow?.webContents.send(IPC.MENU_ACTION, 'prev-tab');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

export function initializeMainProcess(depsInput?: Partial<MainDeps>): void {
  const deps = { ...defaultDeps, ...(depsInput || {}) };
  recoverFromElectronRunAsNode(deps);

  const electronModule = deps.requireElectron();
  if (typeof electronModule === 'string' || !electronModule.app || !electronModule.BrowserWindow) {
    throw new Error('Electron app runtime is unavailable');
  }

  const app = electronModule.app;
  const BrowserWindow = electronModule.BrowserWindow;

  app.setName('MultiClaude');
  if (deps.platform() === 'darwin') {
    app.dock?.setBadge('');
  }

  void app.whenReady().then(() => {
    deps.registerIpcHandlers();
    deps.createAppMenu();
    createMainWindow(deps);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow(deps);
      }
    });
  });

  app.on('window-all-closed', () => {
    deps.killAllPtys();
    if (deps.platform() !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    deps.killAllPtys();
  });
}

if (!(globalThis as any).__MC_DISABLE_AUTO_INIT__) {
  initializeMainProcess();
}
