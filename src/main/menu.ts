import { app, Menu, BrowserWindow, shell } from 'electron';
import { IPC } from '../shared/constants.js';

const isMac = process.platform === 'darwin';

export function createAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [];

  // macOS App menu
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Preferences...',
          accelerator: 'Cmd+,',
          click: () => sendMenuAction('preferences'),
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

  // File menu
  template.push({
    label: 'File',
    submenu: [
      {
        label: 'New Terminal',
        accelerator: 'CmdOrCtrl+T',
        click: () => sendMenuAction('new-terminal'),
      },
      {
        label: 'New System Terminal',
        accelerator: 'CmdOrCtrl+Shift+T',
        click: () => sendMenuAction('new-system-terminal'),
      },
      {
        label: 'New Worktree Terminal',
        accelerator: 'CmdOrCtrl+Alt+T',
        click: () => sendMenuAction('new-worktree-terminal'),
      },
      { type: 'separator' },
      {
        label: 'Close Terminal',
        accelerator: 'CmdOrCtrl+W',
        click: () => sendMenuAction('close-terminal'),
      },
      ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }]),
    ],
  });

  // Edit menu
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
          click: () => sendMenuAction('preferences'),
        },
      ]),
    ],
  });

  // Config menu
  template.push({
    label: 'Config',
    submenu: [
      {
        label: 'New Config',
        accelerator: 'CmdOrCtrl+N',
        click: () => sendMenuAction('new-config'),
      },
      {
        label: 'Edit Config',
        accelerator: 'CmdOrCtrl+E',
        click: () => sendMenuAction('edit-config'),
      },
      {
        label: 'Duplicate Config',
        accelerator: 'CmdOrCtrl+D',
        click: () => sendMenuAction('duplicate-config'),
      },
      {
        label: 'Delete Config',
        click: () => sendMenuAction('delete-config'),
      },
      { type: 'separator' },
      {
        label: 'Import Configs...',
        click: () => sendMenuAction('import-configs'),
      },
      {
        label: 'Export Configs...',
        click: () => sendMenuAction('export-configs'),
      },
    ],
  });

  // Terminal menu
  template.push({
    label: 'Terminal',
    submenu: [
      {
        label: 'Next Tab',
        accelerator: 'CmdOrCtrl+Shift+]',
        click: () => sendMenuAction('next-tab'),
      },
      {
        label: 'Previous Tab',
        accelerator: 'CmdOrCtrl+Shift+[',
        click: () => sendMenuAction('prev-tab'),
      },
      {
        label: 'Next Waiting Terminal',
        accelerator: 'CmdOrCtrl+;',
        click: () => sendMenuAction('next-waiting'),
      },
      {
        label: 'Restore Last Workspace',
        accelerator: 'CmdOrCtrl+Shift+R',
        click: () => sendMenuAction('restore-last-workspace'),
      },
      { type: 'separator' },
      ...Array.from({ length: 9 }, (_, i) => ({
        label: `Go to Tab ${i + 1}`,
        accelerator: `CmdOrCtrl+${i + 1}` as string,
        click: () => sendMenuAction('go-to-tab', i),
      })),
      { type: 'separator' },
      {
        label: 'Clear Terminal',
        accelerator: 'CmdOrCtrl+K',
        click: () => sendMenuAction('clear-terminal'),
      },
      { type: 'separator' },
      {
        label: 'Auto Group by Config',
        click: () => sendMenuAction('auto-group-by-config'),
      },
    ],
  });

  // View menu
  template.push({
    label: 'View',
    submenu: [
      {
        label: 'Toggle Sidebar',
        accelerator: 'CmdOrCtrl+B',
        click: () => sendMenuAction('toggle-sidebar'),
      },
      { type: 'separator' },
      {
        label: 'Zoom In',
        accelerator: 'CmdOrCtrl+=',
        click: () => sendMenuAction('zoom-in'),
      },
      {
        label: 'Zoom Out',
        accelerator: 'CmdOrCtrl+-',
        click: () => sendMenuAction('zoom-out'),
      },
      {
        label: 'Reset Zoom',
        accelerator: 'CmdOrCtrl+0',
        click: () => sendMenuAction('zoom-reset'),
      },
      { type: 'separator' },
      {
        label: 'Toggle Full Screen',
        accelerator: isMac ? 'Cmd+Ctrl+F' : 'F11',
        click: () => {
          const win = BrowserWindow.getFocusedWindow();
          if (win) {
            win.setFullScreen(!win.isFullScreen());
          }
        },
      },
      { type: 'separator' },
      { role: 'toggleDevTools' },
    ],
  });

  // Help menu
  template.push({
    label: 'Help',
    submenu: [
      {
        label: 'Documentation',
        click: () => shell.openExternal('https://github.com/zkkython/MultiClaude'),
      },
      {
        label: 'Report Issue',
        click: () => shell.openExternal('https://github.com/zkkython/MultiClaude/issues'),
      },
    ],
  });

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function sendMenuAction(action: string, payload?: any): void {
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    win.webContents.send(IPC.MENU_ACTION, action, payload);
  }
}
