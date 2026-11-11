import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cameraForPoints,
  cameraOnCenter,
  coordinateOffset,
  distanceMeters,
  zoomOutToFit,
  type LngLat,
} from './camera.ts';

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

test('cameraOnCenter keeps the coordinate on the screen centre', () => {
  const coordinate = { latitude: 16.411, longitude: 120.597 };
  const cam = cameraOnCenter(
    {
      coordinate,
      zoom: 15,
      bounds: {
        ne: { latitude: 16.42, longitude: 120.61 },
        sw: { latitude: 16.4, longitude: 120.58 },
      },
    },
    size
  );
  const s = project([coordinate.longitude, coordinate.latitude], cam);
  assert.ok(Math.abs(s.x - size.width / 2) < 1e-6);
  assert.ok(Math.abs(s.y - size.height / 2) < 1e-6);
  const shifted = cameraForPoints([[coordinate.longitude, coordinate.latitude]], size, {
    insets: { top: 72, right: 0, bottom: 500, left: 0 },
    fallbackZoom: 15,
  })!;
  const off = project([coordinate.longitude, coordinate.latitude], shifted);
  assert.ok(Math.abs(off.y - size.height / 2) > 50);
});

test('coordinateOffset shifts up the screen to the north and back', () => {
  const origin = { latitude: 16.41, longitude: 120.59 };
  const zoom = 13.25;
  const north = coordinateOffset(origin, zoom, 0, -100);
  assert.ok(north.latitude > origin.latitude);
  assert.ok(Math.abs(north.longitude - origin.longitude) < 1e-9);
  const back = coordinateOffset(north, zoom, 0, 100);
  assert.ok(Math.abs(back.latitude - origin.latitude) < 1e-6);
  assert.ok(Math.abs(back.longitude - origin.longitude) < 1e-6);
});

test('zoomOutToFit only zooms out, and only when a pin is outside the visible map', () => {
  const center: LngLat = [120.596, 16.41];
  // The results sheet covers the map centre. That must not block a zoom-out.
  const insets = { top: 72, right: 0, bottom: 520, left: 0 };
  const far: LngLat = [120.62, 16.45];
  const tight = zoomOutToFit([center, far], center, 16, size, insets);
  assert.ok(tight != null && tight < 16);
  const wide = zoomOutToFit([center, far], center, tight! - 1, size, insets);
  assert.equal(wide, null);
  const seen = zoomOutToFit([center, far], center, tight!, size, insets);
  assert.equal(seen, null);
  // A pin already on the map, even under the sheet, does not move the camera.
  const near: LngLat = [120.597, 16.411];
  assert.equal(zoomOutToFit([center, near], center, 16, size, insets), null);
});

test('distanceMeters is roughly right', () => {
  const d = distanceMeters([120.596, 16.4023], [120.596, 16.4113]);
  assert.ok(Math.abs(d - 1000) < 10, String(d));
});
