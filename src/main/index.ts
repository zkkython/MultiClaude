import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { registerIpcHandlers } from './ipc-handlers.js';
import { createAppMenu } from './menu.js';
import { killAllPtys } from './pty-manager.js';
import { DEFAULTS } from '../shared/constants.js';

let mainWindow: BrowserWindow | null = null;

// Set app name so macOS menu bar, Dock, and About dialog show "MultiClaude"
app.setName('MultiClaude');
if (process.platform === 'darwin') {
  // Also set the Dock label
  app.dock?.setBadge('');
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: DEFAULTS.WINDOW_WIDTH,
    height: DEFAULTS.WINDOW_HEIGHT,
    minWidth: DEFAULTS.WINDOW_MIN_WIDTH,
    minHeight: DEFAULTS.WINDOW_MIN_HEIGHT,
    title: 'MultiClaude',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createAppMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  killAllPtys();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  killAllPtys();
});
