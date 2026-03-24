import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorktreeLauncherMarkup } from '../components/WorktreeLauncher.js';

test('worktree launcher markup exposes dual tabs and step-oriented copy', () => {
  const html = buildWorktreeLauncherMarkup('Opus4.6', '/tmp/repo', 'main');

  assert.match(html, /data-tab="worktree"[^>]*>Worktree</);
  assert.match(html, /data-tab="merge"[^>]*>Merge</);
  assert.match(html, /Step 1 · Select repository\./);
  assert.match(html, /Step 2 · Create a new worktree, or choose one from the list\./);
  assert.match(html, /Step 3 · Open terminal and start coding in the selected worktree\./);
  assert.match(html, /Step 1 · Choose target branch for readiness and merge\./);
  assert.match(html, /Step 2 · Choose merge strategy and source ref\./);
  assert.match(html, /Step 3 · Paste into terminal and run after confirming readiness\./);
  assert.match(html, /Target Branch For Merge Readiness/);
  assert.match(html, /Copy Merge Command/);
  assert.match(html, /Generate Merge Command/);
});
