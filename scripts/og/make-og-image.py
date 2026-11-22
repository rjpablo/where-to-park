"""Builds public/og-image.png (1200x630), the link-preview image for Facebook, X, etc.
From the app's brand pin (assets/brand/pin-transparent-cropped.png) and icon colours.
Run: python3 scripts/og/make-og-image.py   (needs Pillow and the Poppins font)."""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
W, H = 1200, 630
TOP, BOTTOM = (0, 56, 140), (0, 86, 196)  # icon gradient, dark to light blue
GREEN = (141, 198, 63)
FONT_DIR = '/usr/share/fonts/truetype/sand-box/google/Poppins'

img = Image.new('RGB', (W, H))
px = img.load()
for y in range(H):
    for x in range(W):
        t = (x / W * 0.6 + y / H * 0.4)
        px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM))

pin = Image.open(os.path.join(ROOT, 'assets/brand/pin-transparent-cropped.png')).convert('RGBA')
ph = 430
pin = pin.resize((round(pin.width * ph / pin.height), ph), Image.LANCZOS)
img.paste(pin, (120, (H - ph) // 2 - 10), pin)

d = ImageDraw.Draw(img)
bold = ImageFont.truetype(os.path.join(FONT_DIR, 'Poppins-Bold.ttf'), 92)
semi = ImageFont.truetype(os.path.join(FONT_DIR, 'Poppins-SemiBold.ttf'), 40)
reg = ImageFont.truetype(os.path.join(FONT_DIR, 'Poppins-Regular.ttf'), 30)
x = 470
d.text((x, 168), 'Where To Park', font=bold, fill='white')
d.text((x, 300), 'Find parking near you', font=semi, fill='white')
d.text((x, 360), 'Open spots, rates and distance', font=reg, fill=(214, 228, 255))
d.text((x, 402), 'on a live map, across the Philippines', font=reg, fill=(214, 228, 255))
d.rounded_rectangle((x, 470, x + 300, 478), radius=4, fill=GREEN)
d.text((x, 500), 'where-to-park.expo.app', font=reg, fill='white')

out = os.path.join(ROOT, 'public/og-image.png')
img.save(out, optimize=True)
print(out, os.path.getsize(out))
