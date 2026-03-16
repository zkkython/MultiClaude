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
    onChanged: (callback) => {
      const handler = () => callback();
      ipcRenderer.on(IPC.CONFIG_CHANGED, handler);
      return () => ipcRenderer.removeListener(IPC.CONFIG_CHANGED, handler);
    },
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
    onState: (callback) => {
      const handler = (_event: any, terminalId: string, state: any) => callback(terminalId, state);
      ipcRenderer.on(IPC.TERMINAL_STATE, handler);
      return () => ipcRenderer.removeListener(IPC.TERMINAL_STATE, handler);
    },
    getStateSnapshot: () => ipcRenderer.invoke(IPC.TERMINAL_STATE_SNAPSHOT_GET),
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
  protocol: {
    startSession: (configId, terminalId) => ipcRenderer.invoke(IPC.RUNNER_SESSION_START, configId, terminalId),
    ingestRawEvent: (sessionId, rawEvent) => ipcRenderer.invoke(IPC.RUNNER_EVENT_INGEST, sessionId, rawEvent),
    resolveInput: (sessionId, requestId) => ipcRenderer.invoke(IPC.RUNNER_INPUT_RESOLVE, sessionId, requestId),
    submitInput: (input) => ipcRenderer.invoke(IPC.RUNNER_INPUT_SUBMIT, input),
    interruptSession: (sessionId) => ipcRenderer.invoke(IPC.RUNNER_SESSION_INTERRUPT, sessionId),
    stopSession: (sessionId) => ipcRenderer.invoke(IPC.RUNNER_SESSION_STOP, sessionId),
    endSession: (sessionId) => ipcRenderer.invoke(IPC.RUNNER_SESSION_END, sessionId),
    onEvent: (callback) => {
      const handler = (_event: any, runnerEvent: any) => callback(runnerEvent);
      ipcRenderer.on(IPC.RUNNER_EVENT, handler);
      return () => ipcRenderer.removeListener(IPC.RUNNER_EVENT, handler);
    },
    getMetrics: () => ipcRenderer.invoke(IPC.RUNNER_METRICS_GET),
    resetMetrics: () => ipcRenderer.invoke(IPC.RUNNER_METRICS_RESET),
    testConnectivity: (input) => ipcRenderer.invoke(IPC.RUNNER_CONNECTIVITY_TEST, input),
  },
};

contextBridge.exposeInMainWorld('multiclaude', api);
