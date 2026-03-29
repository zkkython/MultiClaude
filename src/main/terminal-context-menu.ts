import { IPC } from '../shared/constants.js';

export interface TerminalContextMenuWindow {
  webContents: {
    send: (channel: string, action: string, payload?: any) => void;
  };
}

export function buildTerminalContextMenuTemplate(
  win: TerminalContextMenuWindow,
  terminalId: string,
  hasSelection: boolean,
): Electron.MenuItemConstructorOptions[] {
  return [
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
}
