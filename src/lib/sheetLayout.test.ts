import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expandedHeight,
  peekHeight,
  sheetContainerHeight,
  sheetVisibleHeight,
} from './sheetLayout.ts';

test('peekHeight fits the content plus the bottom inset, within limits', () => {
  assert.equal(peekHeight(150.2, 0, 120, 0.5, 800), 151);
  assert.equal(peekHeight(150, 24, 120, 0.5, 800), 174);
  assert.equal(peekHeight(40, 0, 120, 0.5, 800), 120);
  assert.equal(peekHeight(700, 0, 120, 0.5, 800), 400);
});

test('sheetContainerHeight from either snap point, kept in between', () => {
  // Collapsed: top 650 + 150 tall = 800.
  assert.equal(sheetContainerHeight(0, 650, 150, 680, 0), 800);
  // Expanded: top 120 + 680 tall = 800.
  assert.equal(sheetContainerHeight(1, 120, 150, 680, 0), 800);
  // Mid-drag keeps the last value.
  assert.equal(sheetContainerHeight(0.4, 400, 150, 680, 800), 800);
});

test('sheetVisibleHeight', () => {
  assert.equal(sheetVisibleHeight(800, 650), 150);
  assert.equal(sheetVisibleHeight(800, 900), 0);
});

test('expandedHeight: 85% of the screen, but never over the search box', () => {
  assert.equal(expandedHeight(800, 0.85, 136, 200), 664);
  assert.equal(expandedHeight(1000, 0.85, 136, 200), 850);
  assert.equal(expandedHeight(500, 0.85, 136, 200), 364);
  assert.equal(expandedHeight(250, 0.85, 136, 200), 200);
});
