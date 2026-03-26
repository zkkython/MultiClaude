import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConfigActionsMarkup } from '../components/Sidebar.js';

test('sidebar config actions keep only terminal/worktree inline and move others into more menu', () => {
  const html = buildConfigActionsMarkup('cfg-1');

  assert.match(html, /data-action="new-terminal"/);
  assert.match(html, /data-action="worktree-terminal"/);
  assert.match(html, /data-more-toggle/);
  assert.match(html, /data-more-menu/);
  assert.match(html, /aria-label="More actions: System, Edit, Copy, Delete"/);

  const actions = [
    'system-terminal',
    'edit-config',
    'duplicate-config',
    'delete-config',
  ];
  for (const action of actions) {
    assert.match(html, new RegExp(`data-action="${action}"`));
  }

  assert.match(html, /data-delete-arm/);
  assert.match(html, /data-delete-confirm/);
  assert.match(html, /data-delete-cancel/);
  assert.match(html, /Delete config permanently\?/);
});
