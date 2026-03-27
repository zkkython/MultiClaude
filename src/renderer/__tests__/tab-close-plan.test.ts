import test from 'node:test';
import assert from 'node:assert/strict';
import { getCloseAllTabIds, getCloseOtherTabIds } from '../tab-close-plan.js';

test('getCloseOtherTabIds keeps current tab and returns the rest', () => {
  const tabIds = ['tab-1', 'tab-2', 'tab-3', 'tab-4'];
  const result = getCloseOtherTabIds(tabIds, 'tab-3');
  assert.deepEqual(result, ['tab-1', 'tab-2', 'tab-4']);
});

test('getCloseOtherTabIds returns all tabs when current tab does not exist', () => {
  const tabIds = ['tab-1', 'tab-2'];
  const result = getCloseOtherTabIds(tabIds, 'tab-missing');
  assert.deepEqual(result, ['tab-1', 'tab-2']);
});

test('getCloseAllTabIds returns a shallow copy of all tab ids', () => {
  const tabIds = ['tab-1', 'tab-2'];
  const result = getCloseAllTabIds(tabIds);
  assert.deepEqual(result, ['tab-1', 'tab-2']);
  assert.notEqual(result, tabIds);
});
