import { ipcMain, BrowserWindow, dialog, Menu, Notification } from 'electron';
import { IPC } from '../shared/constants.js';
import * as configStore from './config-store.js';
import { buildEnvForConfig } from './env-builder.js';
import { spawnPty, writePty, resizePty, killPty } from './pty-manager.js';
import { openSystemTerminal } from './system-terminal.js';

let nanoid: (size?: number) => string;

async function ensureNanoid() {
  if (!nanoid) {
    const mod = await import('nanoid');
    nanoid = mod.nanoid;
  }
}

export function registerIpcHandlers(): void {
  // Config handlers
  ipcMain.handle(IPC.CONFIG_GET_ALL, () => {
    return configStore.getAllConfigs();
  });

  ipcMain.handle(IPC.CONFIG_CREATE, async (_event, data) => {
    const config = await configStore.createConfig(data);
    notifyConfigChanged();
    return config;
  });

  ipcMain.handle(IPC.CONFIG_UPDATE, (_event, data) => {
    const config = configStore.updateConfig(data);
    notifyConfigChanged();
    return config;
  });

  ipcMain.handle(IPC.CONFIG_DELETE, (_event, id: string) => {
    configStore.deleteConfig(id);
    notifyConfigChanged();
  });

  ipcMain.handle(IPC.CONFIG_DUPLICATE, async (_event, id: string) => {
    const config = await configStore.duplicateConfig(id);
    notifyConfigChanged();
    return config;
  });

  ipcMain.handle(IPC.CONFIG_EXPORT, async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return false;

    const result = await dialog.showSaveDialog(win, {
      title: 'Export Configurations',
      defaultPath: 'multiclaude-configs.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });

    if (result.canceled || !result.filePath) return false;
    return configStore.exportConfigs(result.filePath);
  });

  ipcMain.handle(IPC.CONFIG_IMPORT, async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      title: 'Import Configurations',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    const importResult = await configStore.importConfigs(result.filePaths[0]);
    if (importResult.imported > 0) {
      notifyConfigChanged();
    }
    return importResult;
  });

  // Terminal handlers
  ipcMain.handle(IPC.TERMINAL_SPAWN, async (_event, configId: string) => {
    await ensureNanoid();
    const config = configStore.getConfigById(configId);
    if (!config) {
      throw new Error(`Config not found: ${configId}`);
    }

    const terminalId = nanoid(12);
    const env = buildEnvForConfig(config);
    const win = BrowserWindow.getFocusedWindow();

    spawnPty(
      terminalId,
      env,
      (data: string) => {
        // Send PTY output to renderer
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC.TERMINAL_DATA, terminalId, data);
        }
      },
      (code: number) => {
        // Notify renderer of exit
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC.TERMINAL_EXIT, terminalId, code);
        }
      }
    );

    return { terminalId };
  });

  ipcMain.on(IPC.TERMINAL_WRITE, (_event, terminalId: string, data: string) => {
    writePty(terminalId, data);
  });

  ipcMain.on(IPC.TERMINAL_RESIZE, (_event, terminalId: string, cols: number, rows: number) => {
    resizePty(terminalId, cols, rows);
  });

  ipcMain.on(IPC.TERMINAL_KILL, (_event, terminalId: string) => {
    killPty(terminalId);
  });

  // System terminal
  ipcMain.handle(IPC.SYSTEM_TERMINAL_OPEN, async (_event, configId: string) => {
    const config = configStore.getConfigById(configId);
    if (!config) {
      throw new Error(`Config not found: ${configId}`);
    }
    await openSystemTerminal(config);
  });

  // Context menu
  ipcMain.on(IPC.CONTEXT_MENU_SHOW, (event, terminalId: string, hasSelection: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'Copy',
        enabled: hasSelection,
        click: () => win.webContents.send(IPC.MENU_ACTION, 'copy'),
      },
      {
        label: 'Paste',
        click: () => win.webContents.send(IPC.MENU_ACTION, 'paste'),
      },
      {
        label: 'Select All',
        click: () => win.webContents.send(IPC.MENU_ACTION, 'select-all', terminalId),
      },
      { type: 'separator' },
      {
        label: 'Clear Terminal',
        click: () => win.webContents.send(IPC.MENU_ACTION, 'clear-terminal', terminalId),
      },
      { type: 'separator' },
      {
        label: 'Open System Terminal',
        click: () => win.webContents.send(IPC.MENU_ACTION, 'open-system-terminal', terminalId),
      },
    ];

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: win });
  });

  // Settings
  ipcMain.handle(IPC.APP_GET_SETTINGS, () => {
    return configStore.getSettings();
  });

  ipcMain.handle(IPC.APP_SAVE_SETTINGS, (_event, settings) => {
    configStore.saveSettings(settings);
  });
}

function notifyConfigChanged(): void {
  const wins = BrowserWindow.getAllWindows();
  for (const win of wins) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.CONFIG_CHANGED);
    }
  }
}
