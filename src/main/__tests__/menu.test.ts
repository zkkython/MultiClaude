import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAppMenuTemplate, createAppMenu } from '../menu.js';
import { IPC } from '../../shared/constants.js';

function findTopLevel(template: Electron.MenuItemConstructorOptions[], label: string): Electron.MenuItemConstructorOptions {
  const hit = template.find((item) => item.label === label);
  assert.ok(hit, `missing top-level menu: ${label}`);
  return hit;
}

function findSubmenuItem(menu: Electron.MenuItemConstructorOptions, label: string): Electron.MenuItemConstructorOptions {
  const submenu = (menu.submenu || []) as Electron.MenuItemConstructorOptions[];
  const hit = submenu.find((item) => item.label === label);
  assert.ok(hit, `missing submenu item: ${label}`);
  return hit;
}

test('buildAppMenuTemplate creates expected structure for non-mac and routes actions', () => {
  const sent: Array<{ action: string; payload?: unknown }> = [];
  const urls: string[] = [];
  let fullscreen = false;

  const template = buildAppMenuTemplate({
    isMac: () => false,
    getAppName: () => 'MultiClaude',
    getFocusedWindow: () => ({
      isFullScreen: () => fullscreen,
      setFullScreen: (value: boolean) => { fullscreen = value; },
      webContents: {
        send: (_channel: string, action: string, payload?: unknown) => {
          sent.push({ action, payload });
        },
      },
    }),
    openExternal: (url: string) => urls.push(url),
  });

  assert.equal(template[0].label, 'File');
  const fileMenu = findTopLevel(template, 'File');
  const editMenu = findTopLevel(template, 'Edit');
  const terminalMenu = findTopLevel(template, 'Terminal');
  const viewMenu = findTopLevel(template, 'View');
  const helpMenu = findTopLevel(template, 'Help');

  const fileSubmenu = (fileMenu.submenu || []) as Electron.MenuItemConstructorOptions[];
  assert.equal(fileSubmenu.some(item => item.role === 'quit'), true);
  const editSubmenu = (editMenu.submenu || []) as Electron.MenuItemConstructorOptions[];
  assert.equal(editSubmenu.some(item => item.label === 'Preferences...'), true);

  findSubmenuItem(fileMenu, 'New Terminal').click?.({} as any, {} as any, {} as any);
  findSubmenuItem(terminalMenu, 'Go to Tab 4').click?.({} as any, {} as any, {} as any);
  findSubmenuItem(viewMenu, 'Toggle Full Screen').click?.({} as any, {} as any, {} as any);
  findSubmenuItem(helpMenu, 'Documentation').click?.({} as any, {} as any, {} as any);
  findSubmenuItem(helpMenu, 'Report Issue').click?.({} as any, {} as any, {} as any);

  assert.equal(fullscreen, true);
  assert.deepEqual(sent[0], { action: 'new-terminal', payload: undefined });
  assert.deepEqual(sent[1], { action: 'go-to-tab', payload: 3 });
  assert.deepEqual(urls, [
    'https://github.com/zkkython/MultiClaude',
    'https://github.com/zkkython/MultiClaude/issues',
  ]);
});

test('buildAppMenuTemplate includes mac app menu and omits non-mac extras', () => {
  const sent: string[] = [];
  const template = buildAppMenuTemplate({
    isMac: () => true,
    getAppName: () => 'MultiClaude',
    getFocusedWindow: () => ({
      isFullScreen: () => false,
      setFullScreen: () => {},
      webContents: {
        send: (channel: string, action: string) => {
          if (channel === IPC.MENU_ACTION) sent.push(action);
        },
      },
    }),
    openExternal: () => {},
  });

  assert.equal(template[0].label, 'MultiClaude');
  const appMenu = template[0];
  findSubmenuItem(appMenu, 'Preferences...').click?.({} as any, {} as any, {} as any);
  assert.deepEqual(sent, ['preferences']);

  const fileMenu = findTopLevel(template, 'File');
  const fileSubmenu = (fileMenu.submenu || []) as Electron.MenuItemConstructorOptions[];
  assert.equal(fileSubmenu.some(item => item.role === 'quit'), false);
});

test('createAppMenu delegates to menu builder/setter', () => {
  let builtTemplate: Electron.MenuItemConstructorOptions[] | null = null;
  let applicationMenu: unknown = null;
  const fakeMenu = { id: 'built-menu' };

  createAppMenu({
    isMac: () => false,
    getAppName: () => 'MultiClaude',
    getFocusedWindow: () => null,
    openExternal: () => {},
    getMenu: () => ({
      buildFromTemplate: (template) => {
        builtTemplate = template;
        return fakeMenu;
      },
      setApplicationMenu: (menu) => {
        applicationMenu = menu;
      },
    }),
  });

  assert.ok(builtTemplate);
  assert.equal(applicationMenu, fakeMenu);
});
