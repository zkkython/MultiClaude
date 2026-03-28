import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAutoFocusTerminal } from '../components/terminal-focus-guard.js';

test('terminal auto focus is disabled while screen workspace is inline-editing', () => {
  const fakeDoc = {
    querySelector: (selector: string) => (
      selector === '.screen-workspace[data-inline-editing="1"]' ? {} : null
    ),
  } as unknown as Document;
  assert.equal(shouldAutoFocusTerminal(true, fakeDoc), false);
});

test('terminal auto focus follows caller intent when workspace is not inline-editing', () => {
  const fakeDoc = {
    querySelector: () => null,
  } as unknown as Document;
  assert.equal(shouldAutoFocusTerminal(true, fakeDoc), true);
  assert.equal(shouldAutoFocusTerminal(false, fakeDoc), false);
});
