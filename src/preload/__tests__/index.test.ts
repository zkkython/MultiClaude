import test from 'node:test';
import assert from 'node:assert/strict';
import { IPC } from '../../shared/constants.js';
import { createApi, initializePreload } from '../index.js';

type Listener = (...args: any[]) => void;

class FakeIpcRenderer {
  invokeCalls: Array<{ channel: string; args: unknown[] }> = [];
  sendCalls: Array<{ channel: string; args: unknown[] }> = [];
  listeners = new Map<string, Listener[]>();

  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    this.invokeCalls.push({ channel, args });
    return Promise.resolve({ channel, args });
  }

  send(channel: string, ...args: unknown[]): void {
    this.sendCalls.push({ channel, args });
  }

  on(channel: string, listener: Listener): void {
    const list = this.listeners.get(channel) || [];
    list.push(listener);
    this.listeners.set(channel, list);
  }

  removeListener(channel: string, listener: Listener): void {
    const list = this.listeners.get(channel) || [];
    this.listeners.set(channel, list.filter((item) => item !== listener));
  }

  emit(channel: string, ...args: unknown[]): void {
    const list = this.listeners.get(channel) || [];
    for (const listener of list) {
      listener({}, ...args);
    }
  }
}

test('createApi wires invoke/send channels for all domains', async () => {
  const ipc = new FakeIpcRenderer();
  const api = createApi(ipc as any);

  await api.config.getAll();
  await api.config.create({ name: 'cfg' } as any);
  await api.config.update({ id: 'cfg-1' } as any);
  await api.config.delete('cfg-1');
  await api.config.duplicate('cfg-1');
  await api.config.export();
  await api.config.import();

  await api.terminal.spawn('cfg-1', { cwd: '/tmp' });
  api.terminal.write('t-1', 'echo hi');
  api.terminal.resize('t-1', 120, 40);
  api.terminal.kill('t-1');
  await api.terminal.getStateSnapshot();

  await api.systemTerminal.open('cfg-1', { cwd: '/tmp' });
  api.contextMenu.show('t-1', true);

  await api.app.getSettings();
  await api.app.saveSettings({ useWebglRenderer: true } as any);
  await api.app.selectDirectory('/tmp');
  await api.app.ensureDirectory('/tmp/x');
  await api.app.writeTextFile('/tmp/x.txt', 'ok');
  await api.app.setIgnoreMenuShortcuts(true);

  await api.worktree.list('/repo');
  await api.worktree.create({} as any);
  await api.worktree.remove({} as any);
  await api.worktree.prune('/repo');
  await api.worktree.status('/repo/w1');
  await api.worktree.mergeReadiness('/repo/w1', 'main');
  await api.worktree.buildMergeTemplate({} as any);

  await api.protocol.startSession('cfg-1', 't-1');
  await api.protocol.ingestRawEvent('s-1', { type: 'x' });
  await api.protocol.resolveInput('s-1', 'req-1');
  await api.protocol.submitInput({ type: 'user_approve', requestId: 'req-1' } as any);
  await api.protocol.interruptSession('s-1');
  await api.protocol.stopSession('s-1');
  await api.protocol.endSession('s-1');
  await api.protocol.getMetrics();
  await api.protocol.resetMetrics();
  await api.protocol.testConnectivity({} as any);
  await api.protocol.getClaudeHooksStatus();
  await api.protocol.installClaudeHooks();

  assert.equal(ipc.sendCalls.length, 4);
  assert.deepEqual(ipc.sendCalls.map((item) => item.channel), [
    IPC.TERMINAL_WRITE,
    IPC.TERMINAL_RESIZE,
    IPC.TERMINAL_KILL,
    IPC.CONTEXT_MENU_SHOW,
  ]);
  assert.ok(ipc.invokeCalls.length > 20);
});

test('createApi event subscriptions forward payloads and can unsubscribe', () => {
  const ipc = new FakeIpcRenderer();
  const api = createApi(ipc as any);

  let changed = 0;
  const offChanged = api.config.onChanged(() => { changed += 1; });

  let onDataPayload = '';
  const offData = api.terminal.onData((terminalId, data) => {
    onDataPayload = `${terminalId}:${data}`;
  });

  let onExitCode = 0;
  const offExit = api.terminal.onExit((_terminalId, code) => {
    onExitCode = code;
  });

  let onStateValue = '';
  const offState = api.terminal.onState((_terminalId, state) => {
    onStateValue = String((state as any).state);
  });

  let menuAction = '';
  const offMenu = api.menu.onAction((action) => {
    menuAction = action;
  });

  let note = '';
  const offNotification = api.app.onNotification((title, body, terminalId) => {
    note = `${title}:${body}:${terminalId}`;
  });

  let runnerEventType = '';
  const offRunnerEvent = api.protocol.onEvent((event) => {
    runnerEventType = String((event as any).type);
  });

  ipc.emit(IPC.CONFIG_CHANGED);
  ipc.emit(IPC.TERMINAL_DATA, 't-1', 'hello');
  ipc.emit(IPC.TERMINAL_EXIT, 't-1', 7);
  ipc.emit(IPC.TERMINAL_STATE, 't-1', { state: 'running' });
  ipc.emit(IPC.MENU_ACTION, 'next-tab');
  ipc.emit(IPC.APP_NOTIFICATION, 'Title', 'Body', 't-1');
  ipc.emit(IPC.RUNNER_EVENT, { type: 'output.delta' });

  assert.equal(changed, 1);
  assert.equal(onDataPayload, 't-1:hello');
  assert.equal(onExitCode, 7);
  assert.equal(onStateValue, 'running');
  assert.equal(menuAction, 'next-tab');
  assert.equal(note, 'Title:Body:t-1');
  assert.equal(runnerEventType, 'output.delta');

  offChanged();
  offData();
  offExit();
  offState();
  offMenu();
  offNotification();
  offRunnerEvent();

  ipc.emit(IPC.CONFIG_CHANGED);
  ipc.emit(IPC.TERMINAL_DATA, 't-1', 'again');
  ipc.emit(IPC.MENU_ACTION, 'prev-tab');
  assert.equal(changed, 1);
  assert.equal(onDataPayload, 't-1:hello');
  assert.equal(menuAction, 'next-tab');
});

test('initializePreload exposes api when electron-like deps exist', () => {
  const ipc = new FakeIpcRenderer();
  let exposed: { key: string; value: unknown } | null = null;
  const ok = initializePreload({
    contextBridge: {
      exposeInMainWorld: (key: string, value: unknown) => {
        exposed = { key, value };
      },
    },
    ipcRenderer: ipc as any,
  });

  assert.equal(ok, true);
  assert.equal(exposed?.key, 'multiclaude');
  assert.equal(typeof exposed?.value, 'object');
});

test('initializePreload returns false when deps are missing', () => {
  assert.equal(initializePreload({ contextBridge: undefined, ipcRenderer: undefined }), false);
});
