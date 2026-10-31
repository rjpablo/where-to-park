import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraForPoints, distanceMeters, type LngLat } from './camera.ts';

const size = { width: 400, height: 800 };

function project(p: LngLat, cam: { center: LngLat; zoom: number }) {
  const world = 512 * 2 ** cam.zoom;
  const mx = (lng: number) => ((lng + 180) / 360) * world;
  const my = (lat: number) => {
    const r = (lat * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(Math.PI / 4 + r / 2)) / Math.PI) / 2) * world;
  };
  return {
    x: size.width / 2 + mx(p[0]) - mx(cam.center[0]),
    y: size.height / 2 + my(p[1]) - my(cam.center[1]),
  };
}

const leaves: LngLat[] = [
  [120.59, 16.41],
  [120.6, 16.415],
  [120.598, 16.405],
];

test('all cluster leaves land inside the visible area', () => {
  const insets = { top: 120, right: 0, bottom: 320, left: 0 };
  const cam = cameraForPoints(leaves, size, { insets, margin: 40 })!;
  for (const p of leaves) {
    const s = project(p, cam);
    assert.ok(s.x >= 40 - 0.5 && s.x <= size.width - 40 + 0.5, `x ${s.x}`);
    assert.ok(
      s.y >= insets.top + 40 - 0.5 && s.y <= size.height - insets.bottom - 40 + 0.5,
      `y ${s.y}`
    );
  }
});

test('the fit is tight: one side touches the margin', () => {
  const cam = cameraForPoints(leaves, size, { margin: 40, maxZoom: 22 })!;
  const xs = leaves.map((p) => project(p, cam).x);
  const ys = leaves.map((p) => project(p, cam).y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  assert.ok(Math.abs(spanX - 320) < 1 || Math.abs(spanY - 720) < 1);
});

test('identical points use the fallback zoom and max zoom caps', () => {
  const same = cameraForPoints(
    [
      [120.6, 16.4],
      [120.6, 16.4],
    ],
    size,
    { fallbackZoom: 17 }
  )!;
  assert.equal(same.zoom, 17);
  const close = cameraForPoints(
    [
      [120.6, 16.4],
      [120.60001, 16.40001],
    ],
    size,
    { maxZoom: 18 }
  )!;
  assert.equal(close.zoom, 18);
});

test('distanceMeters is roughly right', () => {
  const d = distanceMeters([120.596, 16.4023], [120.596, 16.4113]);
  assert.ok(Math.abs(d - 1000) < 10, String(d));
});
