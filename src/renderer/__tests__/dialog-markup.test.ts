import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWelcomeScreenMarkup } from '../components/WelcomeScreen.js';
import { buildPreflightDialogMarkup } from '../components/PreflightDialog.js';
import { buildScreenCloseDialogMarkup } from '../components/ScreenCloseDialog.js';
import { buildPreferencesEditorMarkup } from '../components/PreferencesEditor.js';

test('welcome screen markup includes onboarding copy and create button', () => {
  const html = buildWelcomeScreenMarkup();
  assert.match(html, /welcome-icon/);
  assert.match(html, /Run Claude and Codex configurations in isolated parallel terminals\./);
  assert.match(html, /id="welcome-create-btn"/);
});

test('preflight dialog markup renders blockers and fix action buttons', () => {
  const html = buildPreflightDialogMarkup({
    configName: '<unsafe&name>',
    issues: [
      { severity: 'blocker', message: 'Missing <token>', fixAction: 'edit-config' } as any,
      { severity: 'warning', message: 'Hooks not installed', fixAction: 'install-claude-hooks' } as any,
      { severity: 'warning', message: 'Transport mismatch', fixAction: 'set-transport-pty' } as any,
      { severity: 'warning', message: 'Headers invalid', fixAction: 'clear-headers-json' } as any,
    ],
  });

  assert.match(html, /Preflight Check · &lt;unsafe&amp;name&gt;/);
  assert.match(html, /Blocking issues/);
  assert.match(html, /Missing &lt;token&gt;/);
  assert.match(html, /Warnings/);
  assert.match(html, /id="preflight-edit"/);
  assert.match(html, /id="preflight-install-hooks"/);
  assert.match(html, /id="preflight-fix-transport"/);
  assert.match(html, /id="preflight-clear-headers"/);
  assert.doesNotMatch(html, /id="preflight-continue"/);
});

test('preflight dialog markup renders continue only when blockers are absent', () => {
  const html = buildPreflightDialogMarkup({
    configName: 'cfg-a',
    issues: [{ severity: 'warning', message: 'FYI', fixAction: null } as any],
  });
  assert.match(html, /id="preflight-cancel"/);
  assert.match(html, /id="preflight-continue"/);
});

test('screen close dialog markup escapes identifiers and includes clear action', () => {
  const html = buildScreenCloseDialogMarkup({
    screenId: 'screen-<1>',
    screenName: 'Main & Dev',
    tabCount: 7,
  });

  assert.match(html, /Close Screen/);
  assert.match(html, /Screen: <code>screen-&lt;1&gt;<\/code> · Main &amp; Dev/);
  assert.match(html, /Tabs in this screen: 7/);
  assert.match(html, /id="screen-close-session"/);
  assert.match(html, /id="screen-close-clear"/);
});

test('preferences editor markup toggles checked state based on settings', () => {
  const checked = buildPreferencesEditorMarkup({ useWebglRenderer: true } as any);
  const unchecked = buildPreferencesEditorMarkup({ useWebglRenderer: false } as any);

  assert.match(checked, /id="pref-use-webgl-renderer" checked/);
  assert.doesNotMatch(unchecked, /id="pref-use-webgl-renderer" checked/);
  assert.match(checked, /Use WebGL terminal renderer \(experimental\)/);
  assert.match(checked, /id="preferences-save"/);
});
