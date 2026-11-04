import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBackToExit } from './backToExit.ts';
import { backFallback } from './backFallback.ts';

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

test('no history but a parent page: go one level up, never warn', () => {
  const press = createBackToExit();
  assert.equal(press(false, 0, '/operator/hub/x'), 'up');
  assert.equal(press(false, 100, '/operator/listings'), 'up');
  assert.equal(press(false, 200, '/search'), 'up');
});

test('history wins over the parent page', () => {
  const press = createBackToExit();
  assert.equal(press(true, 0, '/operator/hub/x'), 'navigate');
});

test('climbs level by level to Search, then press-again-to-close', () => {
  // Opened cold on a listing subpage: each Back replaces the page with its parent.
  const press = createBackToExit();
  const chain: string[] = [];
  let route = 'operator/rates';
  let params: Record<string, string> = { locationId: 'L' };
  const toRoute = (path: string): [string, Record<string, string>] => {
    const hub = path.match(/^\/operator\/hub\/(.+)$/);
    if (hub) return ['operator/hub/[id]', { id: hub[1] }];
    return [path.slice(1), {}];
  };
  let t = 0;
  for (;;) {
    const parent = backFallback(route, params);
    const r = press(false, (t += 100), parent);
    if (r !== 'up') {
      chain.push(r);
      break;
    }
    chain.push(parent!);
    [route, params] = toRoute(parent!);
  }
  assert.deepEqual(chain, ['/operator/hub/L', '/operator/listings', '/search', 'warn']);
  assert.equal(press(false, (t += 500), backFallback('search')), 'exit');
});

test('a warning on Search is reset by going up from another screen', () => {
  const press = createBackToExit();
  assert.equal(press(false, 0), 'warn');
  assert.equal(press(false, 500, '/search'), 'up');
  assert.equal(press(false, 1000), 'warn');
});
