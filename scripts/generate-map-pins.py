#!/usr/bin/env python3
"""Generate the teardrop map pin PNGs used by the native MapLibre map.

Geometry must match src/components/map/pins.ts (web draws the same shape on a canvas).
Run: python3 scripts/generate-map-pins.py
"""
import math
import os
from PIL import Image, ImageDraw

W, H = 34, 44          # 1x size in px; the tip is at the bottom centre
R = 14                 # inner bulb radius
STROKE = 2.5           # white outline
CY = 16                # bulb centre y
COLORS = {
    'pin-open': '#10b981',
    'pin-full': '#ef4444',
    'pin-stale': '#f59e0b',
    'pin-place': '#2563eb',
}
SS = 8  # supersampling factor
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'map')


def teardrop(cx, cy, r, tip_y, scale):
    d = tip_y - cy
    phi = math.acos(r / d)  # angle between "down" and the tangent point
    pts = [(cx * scale, tip_y * scale)]
    steps = 96
    # from right tangent point, over the top, to the left tangent point
    start = phi
    end = 2 * math.pi - phi
    for i in range(steps + 1):
        a = start + (end - start) * i / steps
        x = cx + r * math.sin(a)
        y = cy + r * math.cos(a)
        pts.append((x * scale, y * scale))
    return pts


def render(name, color, scale):
    s = scale * SS
    img = Image.new('RGBA', (W * s, H * s), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    cx = W / 2
    # soft shadow
    dr.polygon(teardrop(cx + 0.6, CY + 1.0, R + STROKE, H - 0.2, s), fill=(0, 0, 0, 60))
    dr.polygon(teardrop(cx, CY, R + STROKE, H - 1.0, s), fill='#ffffff')
    dr.polygon(teardrop(cx, CY, R, H - 1.0 - STROKE * 1.6, s), fill=color)
    if name == 'pin-place':
        dr.ellipse([(cx - 5) * s, (CY - 5) * s, (cx + 5) * s, (CY + 5) * s], fill='#ffffff')
    img = img.resize((W * scale, H * scale), Image.LANCZOS)
    suffix = '' if scale == 1 else f'@{scale}x'
    img.save(os.path.join(OUT, f'{name}{suffix}.png'))


os.makedirs(OUT, exist_ok=True)
for n, c in COLORS.items():
    for sc in (1, 2, 3):
        render(n, c, sc)
print('ok')
