import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authDestination, safeNext } from './authReturn.ts';

test('safeNext keeps in-app paths and drops the rest', () => {
  assert.equal(safeNext('/reserve/abc'), '/reserve/abc');
  assert.equal(safeNext('/sessions/abc?x=1'), '/sessions/abc?x=1');
  assert.equal(safeNext('%2Freserve%2Fabc'), '/reserve/abc');
  assert.equal(safeNext('https://evil.test'), null);
  assert.equal(safeNext('//evil.test'), null);
  assert.equal(safeNext('reserve/abc'), null);
  assert.equal(safeNext(null), null);
});

test('authDestination uses the param, else search', () => {
  assert.equal(authDestination('/sessions'), '/sessions');
  assert.equal(authDestination('https://evil.test'), '/search');
  assert.equal(authDestination(null), '/search');
});
