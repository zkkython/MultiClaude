import { IPC } from '../shared/constants.js';

interface MenuLike {
  buildFromTemplate: (template: Electron.MenuItemConstructorOptions[]) => unknown;
  setApplicationMenu: (menu: unknown) => void;
}

interface FocusedWindowLike {
  isFullScreen: () => boolean;
  setFullScreen: (value: boolean) => void;
  webContents: {
    send: (channel: string, action: string, payload?: any) => void;
  };
}

interface MenuDeps {
  getAppName: () => string;
  isMac: () => boolean;
  getMenu: () => MenuLike;
  getFocusedWindow: () => FocusedWindowLike | null;
  openExternal: (url: string) => void;
}

const defaultDeps: MenuDeps = {
  getAppName: () => {
    const { app } = require('electron') as typeof import('electron');
    return app.name;
  },
  isMac: () => process.platform === 'darwin',
  getMenu: () => {
    const { Menu } = require('electron') as typeof import('electron');
    return Menu;
  },
  getFocusedWindow: () => {
    const { BrowserWindow } = require('electron') as typeof import('electron');
    return BrowserWindow.getFocusedWindow() as FocusedWindowLike | null;
  },
  openExternal: (url: string) => {
    const { shell } = require('electron') as typeof import('electron');
    void shell.openExternal(url);
  },
};

function sendMenuAction(deps: MenuDeps, action: string, payload?: any): void {
  const win = deps.getFocusedWindow();
  if (win) {
    win.webContents.send(IPC.MENU_ACTION, action, payload);
  }
}

export function buildAppMenuTemplate(depsInput?: Partial<MenuDeps>): Electron.MenuItemConstructorOptions[] {
  const deps = { ...defaultDeps, ...(depsInput || {}) };
  const isMac = deps.isMac();
  const template: Electron.MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: deps.getAppName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Preferences...',
          accelerator: 'Cmd+,',
          click: () => sendMenuAction(deps, 'preferences'),
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push({
    label: 'File',
    submenu: [
      {
        label: 'New Terminal',
        accelerator: 'CmdOrCtrl+T',
        click: () => sendMenuAction(deps, 'new-terminal'),
      },
      {
        label: 'New System Terminal',
        accelerator: 'CmdOrCtrl+Shift+T',
        click: () => sendMenuAction(deps, 'new-system-terminal'),
      },
      {
        label: 'New Worktree Terminal',
        accelerator: 'CmdOrCtrl+Alt+T',
        click: () => sendMenuAction(deps, 'new-worktree-terminal'),
      },
      { type: 'separator' },
      {
        label: 'Close Terminal',
        accelerator: 'CmdOrCtrl+W',
        click: () => sendMenuAction(deps, 'close-terminal'),
      },
      ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }]),
    ],
  });

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
      ...(isMac ? [] : [
        { type: 'separator' as const },
        {
          label: 'Preferences...',
          accelerator: 'Ctrl+,',
          click: () => sendMenuAction(deps, 'preferences'),
        },
      ]),
    ],
  });

  template.push({
    label: 'Config',
    submenu: [
      {
        label: 'New Config',
        accelerator: 'CmdOrCtrl+N',
        click: () => sendMenuAction(deps, 'new-config'),
      },
      {
        label: 'Edit Config',
        accelerator: 'CmdOrCtrl+E',
        click: () => sendMenuAction(deps, 'edit-config'),
      },
      {
        label: 'Duplicate Config',
        accelerator: 'CmdOrCtrl+D',
        click: () => sendMenuAction(deps, 'duplicate-config'),
      },
      {
        label: 'Delete Config',
        click: () => sendMenuAction(deps, 'delete-config'),
      },
      { type: 'separator' },
      {
        label: 'Import Configs...',
        click: () => sendMenuAction(deps, 'import-configs'),
      },
      {
        label: 'Export Configs...',
        click: () => sendMenuAction(deps, 'export-configs'),
      },
    ],
  });

  template.push({
    label: 'Terminal',
    submenu: [
      {
        label: 'Next Tab',
        accelerator: 'CmdOrCtrl+Shift+]',
        click: () => sendMenuAction(deps, 'next-tab'),
      },
      {
        label: 'Previous Tab',
        accelerator: 'CmdOrCtrl+Shift+[',
        click: () => sendMenuAction(deps, 'prev-tab'),
      },
      {
        label: 'Next Waiting Terminal',
        accelerator: 'CmdOrCtrl+;',
        click: () => sendMenuAction(deps, 'next-waiting'),
      },
      { type: 'separator' },
      ...Array.from({ length: 9 }, (_, i) => ({
        label: `Go to Tab ${i + 1}`,
        accelerator: `CmdOrCtrl+${i + 1}` as string,
        click: () => sendMenuAction(deps, 'go-to-tab', i),
      })),
      { type: 'separator' },
      {
        label: 'Clear Terminal',
        accelerator: 'CmdOrCtrl+K',
        click: () => sendMenuAction(deps, 'clear-terminal'),
      },
      { type: 'separator' },
      {
        label: 'Auto Group by Config',
        click: () => sendMenuAction(deps, 'auto-group-by-config'),
      },
    ],
  });

  template.push({
    label: 'View',
    submenu: [
      {
        label: 'Toggle Sidebar',
        accelerator: 'CmdOrCtrl+B',
        click: () => sendMenuAction(deps, 'toggle-sidebar'),
      },
      { type: 'separator' },
      {
        label: 'Zoom In',
        accelerator: 'CmdOrCtrl+=',
        click: () => sendMenuAction(deps, 'zoom-in'),
      },
      {
        label: 'Zoom Out',
        accelerator: 'CmdOrCtrl+-',
        click: () => sendMenuAction(deps, 'zoom-out'),
      },
      {
        label: 'Reset Zoom',
        accelerator: 'CmdOrCtrl+0',
        click: () => sendMenuAction(deps, 'zoom-reset'),
      },
      { type: 'separator' },
      {
        label: 'Toggle Full Screen',
        accelerator: isMac ? 'Cmd+Ctrl+F' : 'F11',
        click: () => {
          const win = deps.getFocusedWindow();
          if (win) {
            win.setFullScreen(!win.isFullScreen());
          }
        },
      },
      { type: 'separator' },
      { role: 'toggleDevTools' },
    ],
  });

  template.push({
    label: 'Help',
    submenu: [
      {
        label: 'Documentation',
        click: () => deps.openExternal('https://github.com/zkkython/MultiClaude'),
      },
      {
        label: 'Report Issue',
        click: () => deps.openExternal('https://github.com/zkkython/MultiClaude/issues'),
      },
    ],
  });

  return template;
}

export function createAppMenu(depsInput?: Partial<MenuDeps>): void {
  const deps = { ...defaultDeps, ...(depsInput || {}) };
  const menu = deps.getMenu();
  const template = buildAppMenuTemplate(deps);
  const built = menu.buildFromTemplate(template);
  menu.setApplicationMenu(built);
}
