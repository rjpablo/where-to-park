import test from 'node:test';
import assert from 'node:assert/strict';
import {
  maximizedHeight,
  nextSheetMode,
  normalHeight,
  peekHeight,
  sheetModeAt,
  sheetModeIndex,
} from './sheetLayout.ts';

test('peekHeight fits the content plus the bottom inset, within limits', () => {
  assert.equal(peekHeight(150.2, 0, 120, 0.5, 800), 151);
  assert.equal(peekHeight(150, 24, 120, 0.5, 800), 174);
  assert.equal(peekHeight(40, 0, 120, 0.5, 800), 120);
  assert.equal(peekHeight(700, 0, 120, 0.5, 800), 400);
});

test('normalHeight: 65% of the search screen, above Minimized', () => {
  assert.equal(normalHeight(804, 0.65, 217), 523); // 412x860 web: screen 804 below a 56 px header
  assert.equal(normalHeight(684, 0.65, 217), 445); // 360x740
  assert.equal(normalHeight(512, 0.65, 217), 333); // 320x568
  assert.equal(normalHeight(300, 0.65, 217), 218); // never at or below Minimized
});

test('maximizedHeight: 10 px of map between the header and the sheet', () => {
  assert.equal(maximizedHeight(804, 10, 523), 794);
  assert.equal(maximizedHeight(512, 10, 333), 502);
  assert.equal(maximizedHeight(200, 10, 218), 219); // stays above Normal
});

test('sheet modes: index mapping and handle-tap cycle', () => {
  assert.equal(sheetModeIndex('minimized'), 0);
  assert.equal(sheetModeIndex('normal'), 1);
  assert.equal(sheetModeIndex('maximized'), 2);
  assert.equal(sheetModeAt(1.2), 'normal');
  assert.equal(sheetModeAt(-1), 'minimized');
  assert.equal(sheetModeAt(5), 'maximized');
  assert.equal(nextSheetMode('minimized'), 'normal');
  assert.equal(nextSheetMode('normal'), 'maximized');
  assert.equal(nextSheetMode('maximized'), 'minimized');
});
