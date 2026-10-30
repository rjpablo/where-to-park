import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBackToExit } from './backToExit.ts';

test('screens with history navigate back normally', () => {
  const press = createBackToExit();
  assert.equal(press(true, 0), 'navigate');
  assert.equal(press(true, 100), 'navigate');
});

test('root screen: warn first, exit on a second press within 2s', () => {
  const press = createBackToExit();
  assert.equal(press(false, 1000), 'warn');
  assert.equal(press(false, 2500), 'exit');
});

test('a late second press warns again instead of exiting', () => {
  const press = createBackToExit();
  assert.equal(press(false, 0), 'warn');
  assert.equal(press(false, 2001), 'warn');
  assert.equal(press(false, 3000), 'exit');
});

test('navigating back in between resets the warning', () => {
  const press = createBackToExit();
  assert.equal(press(false, 0), 'warn');
  assert.equal(press(true, 500), 'navigate');
  assert.equal(press(false, 1000), 'warn');
});
