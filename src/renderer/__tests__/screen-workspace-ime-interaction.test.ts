import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRenameImeGuardState,
  getRenameKeyIntent,
  onRenameCompositionEnd,
  onRenameCompositionStart,
} from '../components/screen-workspace-ime-guard.js';

test('New Group rename IME flow: composing Enter should not commit, post-lock Enter should commit', () => {
  const guard = createRenameImeGuardState();
  const t0 = 1_000;

  // User starts IME composition while renaming newly-created group.
  onRenameCompositionStart(guard);
  assert.equal(getRenameKeyIntent({ key: 'Enter', isComposing: true, keyCode: 229 }, guard, t0), null);

  // IME commit ends composition; immediate Enter is still lock-protected.
  onRenameCompositionEnd(guard, t0);
  assert.equal(getRenameKeyIntent({ key: 'Enter', keyCode: 13 }, guard, t0 + 40), null);

  // After lock window, Enter can submit.
  assert.equal(getRenameKeyIntent({ key: 'Enter', keyCode: 13 }, guard, t0 + 140), 'commit');
});

test('New Group rename IME flow: Escape cancels only when not composing', () => {
  const guard = createRenameImeGuardState();
  onRenameCompositionStart(guard);
  assert.equal(getRenameKeyIntent({ key: 'Escape', isComposing: true }, guard, 100), null);

  onRenameCompositionEnd(guard, 200);
  assert.equal(getRenameKeyIntent({ key: 'Escape' }, guard, 400), 'cancel');
});
