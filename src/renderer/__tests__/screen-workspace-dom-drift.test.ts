import test from 'node:test';
import assert from 'node:assert/strict';
import { hasScreenWorkspaceDomDrift } from '../components/ScreenWorkspace.js';

test('detects ghost third screen in DOM when only two visible screens should exist', () => {
  const domScreenIds = ['screen-a', 'screen-b', 'screen-c'];
  const visibleScreenIds = ['screen-a', 'screen-b'];
  const cacheScreenIds = ['screen-a', 'screen-b'];
  assert.equal(hasScreenWorkspaceDomDrift(domScreenIds, visibleScreenIds, cacheScreenIds), true);
});

test('detects drift when DOM has duplicate screen pane ids', () => {
  const domScreenIds = ['screen-a', 'screen-b', 'screen-b'];
  const visibleScreenIds = ['screen-a', 'screen-b'];
  const cacheScreenIds = ['screen-a', 'screen-b'];
  assert.equal(hasScreenWorkspaceDomDrift(domScreenIds, visibleScreenIds, cacheScreenIds), true);
});

test('does not report drift when DOM/order/cache all match visible screens', () => {
  const domScreenIds = ['screen-a', 'screen-b'];
  const visibleScreenIds = ['screen-a', 'screen-b'];
  const cacheScreenIds = ['screen-a', 'screen-b'];
  assert.equal(hasScreenWorkspaceDomDrift(domScreenIds, visibleScreenIds, cacheScreenIds), false);
});
