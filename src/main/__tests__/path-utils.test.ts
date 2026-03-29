import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePathSegment } from '../path-utils.js';

test('sanitizePathSegment normalizes unsafe characters and separators', () => {
  assert.equal(sanitizePathSegment(' team/a\\b:c*d?e '), 'team-a-b-c-d-e');
  assert.equal(sanitizePathSegment('alpha___beta'), 'alpha___beta');
  assert.equal(sanitizePathSegment('x---y'), 'x-y');
});

test('sanitizePathSegment falls back to profile when input is empty after normalization', () => {
  assert.equal(sanitizePathSegment(''), 'profile');
  assert.equal(sanitizePathSegment('   '), 'profile');
  assert.equal(sanitizePathSegment('////'), 'profile');
});
