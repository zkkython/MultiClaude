import test from 'node:test';
import assert from 'node:assert/strict';
import { IPC } from '../../shared/constants.js';
import { buildTerminalContextMenuTemplate } from '../terminal-context-menu.js';

test('buildTerminalContextMenuTemplate wires actions and payloads', () => {
  const sent: Array<{ action: string; payload?: unknown }> = [];
  const win = {
    webContents: {
      send: (_channel: string, action: string, payload?: unknown) => {
        sent.push({ action, payload });
      },
    },
  };

  const template = buildTerminalContextMenuTemplate(win, 'term-1', true);
  assert.equal(template.length, 7);
  assert.equal(template[0].label, 'Copy');
  assert.equal(template[0].enabled, true);
  assert.equal(template[1].label, 'Paste');
  assert.equal(template[2].label, 'Select All');
  assert.equal(template[3].type, 'separator');
  assert.equal(template[5].type, 'separator');
  assert.equal(template[6].label, 'Open System Terminal');

  template[0].click?.({} as any, {} as any, {} as any);
  template[1].click?.({} as any, {} as any, {} as any);
  template[2].click?.({} as any, {} as any, {} as any);
  template[4].click?.({} as any, {} as any, {} as any);
  template[6].click?.({} as any, {} as any, {} as any);

  assert.deepEqual(sent.map((item) => item.action), [
    'copy',
    'paste',
    'select-all',
    'clear-terminal',
    'open-system-terminal',
  ]);
  assert.equal(sent[2].payload, 'term-1');
  assert.equal(sent[3].payload, 'term-1');
  assert.equal(sent[4].payload, 'term-1');
});

test('buildTerminalContextMenuTemplate disables Copy when no selection exists', () => {
  const template = buildTerminalContextMenuTemplate({
    webContents: { send: () => {} },
  }, 'term-2', false);

  assert.equal(template[0].enabled, false);
});
