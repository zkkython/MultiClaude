import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/constants.js';
import type { MultiClaudeAPI } from '../shared/types.js';

const api: MultiClaudeAPI = {
  config: {
    getAll: () => ipcRenderer.invoke(IPC.CONFIG_GET_ALL),
    create: (data) => ipcRenderer.invoke(IPC.CONFIG_CREATE, data),
    update: (data) => ipcRenderer.invoke(IPC.CONFIG_UPDATE, data),
    delete: (id) => ipcRenderer.invoke(IPC.CONFIG_DELETE, id),
    duplicate: (id) => ipcRenderer.invoke(IPC.CONFIG_DUPLICATE, id),
    export: () => ipcRenderer.invoke(IPC.CONFIG_EXPORT),
    import: () => ipcRenderer.invoke(IPC.CONFIG_IMPORT),
  },
  terminal: {
    spawn: (configId) => ipcRenderer.invoke(IPC.TERMINAL_SPAWN, configId),
    write: (terminalId, data) => ipcRenderer.send(IPC.TERMINAL_WRITE, terminalId, data),
    resize: (terminalId, cols, rows) => ipcRenderer.send(IPC.TERMINAL_RESIZE, terminalId, cols, rows),
    kill: (terminalId) => ipcRenderer.send(IPC.TERMINAL_KILL, terminalId),
    onData: (callback) => {
      const handler = (_event: any, terminalId: string, data: string) => callback(terminalId, data);
      ipcRenderer.on(IPC.TERMINAL_DATA, handler);
      return () => ipcRenderer.removeListener(IPC.TERMINAL_DATA, handler);
    },
    onExit: (callback) => {
      const handler = (_event: any, terminalId: string, code: number) => callback(terminalId, code);
      ipcRenderer.on(IPC.TERMINAL_EXIT, handler);
      return () => ipcRenderer.removeListener(IPC.TERMINAL_EXIT, handler);
    },
  },
  systemTerminal: {
    open: (configId) => ipcRenderer.invoke(IPC.SYSTEM_TERMINAL_OPEN, configId),
  },
  contextMenu: {
    show: (terminalId, hasSelection) => ipcRenderer.send(IPC.CONTEXT_MENU_SHOW, terminalId, hasSelection),
  },
  menu: {
    onAction: (callback) => {
      const handler = (_event: any, action: string, payload?: any) => callback(action, payload);
      ipcRenderer.on(IPC.MENU_ACTION, handler);
      return () => ipcRenderer.removeListener(IPC.MENU_ACTION, handler);
    },
  },
  app: {
    onNotification: (callback) => {
      const handler = (_event: any, title: string, body: string, terminalId?: string) => callback(title, body, terminalId);
      ipcRenderer.on(IPC.APP_NOTIFICATION, handler);
      return () => ipcRenderer.removeListener(IPC.APP_NOTIFICATION, handler);
    },
    getSettings: () => ipcRenderer.invoke(IPC.APP_GET_SETTINGS),
    saveSettings: (settings) => ipcRenderer.invoke(IPC.APP_SAVE_SETTINGS, settings),
  },
};

contextBridge.exposeInMainWorld('multiclaude', api);
