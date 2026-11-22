import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupRatesByArea, rateFitsVehicle, showAreaHeadings } from './areaRates.ts';

const main = { id: 'm', name: 'Main', is_main: true, sort_order: 0, vehicle_types: null };
const moto = {
  id: 'b',
  name: 'Basement',
  is_main: false,
  sort_order: 1,
  vehicle_types: ['motorcycle'],
};

test('PAD-6: default first, then each area (Main first); deleted rates left out', () => {
  const g = groupRatesByArea(
    [
      { id: '1', is_default: false, area_id: 'b' },
      { id: '2', is_default: true, area_id: null },
      { id: '3', is_default: false, area_id: 'm' },
      { id: '4', is_default: false, area_id: 'm', deleted_at: '2026-11-22' },
      { id: '5', is_default: false, area_id: 'gone' },
    ],
    [moto, main]
  );
  assert.deepEqual(
    g.defaults.map((r) => r.id),
    ['2']
  );
  assert.deepEqual(
    g.sections.map((s) => [s.area.name, s.rates.map((r) => r.id)]),
    [
      ['Main', ['3']],
      ['Basement', ['1']],
    ]
  );
});

test('PAD-6: area headings only with 2+ areas', () => {
  assert.equal(showAreaHeadings([main]), false);
  assert.equal(showAreaHeadings([main, moto]), true);
});

test('PAD-6: rates inherit their area vehicle types; the default takes any vehicle', () => {
  const def = { id: 'd', is_default: true, area_id: null };
  const motoRate = { id: 'r', is_default: false, area_id: 'b' };
  assert.equal(rateFitsVehicle(def, null, 'truck'), true);
  assert.equal(rateFitsVehicle(motoRate, moto, 'motorcycle'), true);
  assert.equal(rateFitsVehicle(motoRate, moto, 'car'), false);
  assert.equal(rateFitsVehicle(motoRate, main, 'car'), true);
  // No vehicle picked: any rate without its own vehicle limit counts.
  assert.equal(rateFitsVehicle(motoRate, moto, null), true);
  // A rate's own vehicle limit still applies.
  const carOnly = { id: 'c', is_default: false, area_id: 'm', vehicle_type: 'car' };
  assert.equal(rateFitsVehicle(carOnly, main, 'car'), true);
  assert.equal(rateFitsVehicle(carOnly, main, 'suv'), false);
  assert.equal(rateFitsVehicle(carOnly, main, null), false);
  assert.equal(rateFitsVehicle({ ...motoRate, deleted_at: 'x' }, moto, 'motorcycle'), false);
});
