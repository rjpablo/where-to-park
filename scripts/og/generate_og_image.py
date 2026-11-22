#!/usr/bin/env python3
"""Generate Open Graph share images for Where To Park.

`npm run og:image` (--default) writes the site-wide public/og-image.png:
headline "Find parking near you", no place name. --place renders the
per-place variant ("Parking near <Place>") for review; it is not used on
the site (no server rendering yet).

Assets: assets/icon.png and assets/brand/pin-transparent-cropped.png from the
app; scripts/og/assets/en_badge_web_generic.png is Google's official
"Get it on Google Play" badge (https://play.google.com/intl/en_us/badges/),
used unmodified per Google's badge guidelines; scripts/og/fonts/Inter is
under the SIL Open Font License 1.1 (scripts/og/fonts/OFL.txt).
Requires Pillow, numpy and qrcode (pip install pillow numpy qrcode);
--verify-qr also needs zxing-cpp or opencv-python.

Original description:

Renders a 1200x630 PNG with the app's brand gradient, a subtle
map-like pattern drawn in code, the real app icon + "Where To Park"
wordmark, an auto-fitted "Parking near <Place>" headline (wraps up
to 3 lines and shrinks as needed), a short subline, and a Play Store
download CTA: a "Get the app on Google Play" line, the official
unmodified "Get it on Google Play" badge, and a QR code to the
app's Play listing.

Designed so it can later run at deploy time, once per sitemap place.

Usage:
  python3 generate_og_image.py --place "Pasay" --out out/og-pasay.png
  python3 generate_og_image.py --samples
  python3 generate_og_image.py --default --verify-qr   # public/og-image.png
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import qrcode
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from qrcode.constants import ERROR_CORRECT_H, ERROR_CORRECT_M, ERROR_CORRECT_Q

# Canvas — Facebook / Open Graph landscape recommended size
WIDTH, HEIGHT = 1200, 630

# Brand colors sampled from assets/icon.png and android-icon-background.png,
# plus the official adaptive-icon / splash background (#0047A0) and theme.
GRAD_TOP_LEFT = (1, 51, 122)      # icon / adaptive background, top-left
GRAD_BOTTOM_RIGHT = (1, 89, 199)  # icon / adaptive background, bottom-right
BRAND_BLUE = (0, 71, 160)         # #0047A0 — splash / adaptiveIcon backgroundColor
PIN_GREEN = (143, 198, 71)        # #8FC647 — green oval under the pin
WHITE = (255, 255, 255)
TEXT_MUTED = (210, 226, 245)      # soft blue-white for supporting copy

# Safe margins so rounded-corner / slight Facebook crops don't clip text,
# the badge, or the QR. 80px is ~6.7% of width; 56px is ~9% of height.
MARGIN_X = 80
MARGIN_Y = 56

# Headline auto-fit
HEADLINE_MAX_SIZE = 84
HEADLINE_MIN_SIZE = 40
HEADLINE_MAX_LINES = 3
HEADLINE_LINE_HEIGHT = 1.12

SUBLINE = "Find available spots, rates and reservations"
PROMO_LINE = "Get the app on Google Play"

# Verified against app.json expo.android.package.
PLAY_LISTING_URL = (
    "https://play.google.com/store/apps/details?id=com.thebadcompany.wheretopark"
)

# Official "Get it on Google Play" badge from
# https://play.google.com/intl/en_us/badges/
# (en_badge_web_generic.png, 646x250). The file already includes transparent
# padding of 41px, which is one-quarter of the 168px visible badge height —
# the clear space Google requires. Scale uniformly; never crop, recolor, or
# rearrange. Digital minimum visible height is 28px; we draw it much larger
# so it stays above that after Facebook scales the preview down.
BADGE_ASSET_SIZE = (646, 250)
BADGE_CONTENT_SIZE = (564, 168)  # visible badge inside the official file
BADGE_ASSET_HEIGHT = 124  # full official asset including its clear space
# Visible height ≈ 124 * 168/250 ≈ 83px, ~3x the 28px minimum.

# QR target size includes the 4-module quiet zone. Error correction Q is
# above the required M and stays more compact than H, so modules can be
# larger and more readable at Facebook preview sizes.
QR_SIZE = 252
QR_ERROR = "Q"
QR_BORDER_MODULES = 4

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
DEFAULT_ICON = REPO / "assets" / "icon.png"
DEFAULT_PIN = REPO / "assets" / "brand" / "pin-transparent-cropped.png"
DEFAULT_BADGE = HERE / "assets" / "en_badge_web_generic.png"
SITE_IMAGE = REPO / "public" / "og-image.png"
SITE_HEADLINE = "Find parking near you"
INTER_PATH = HERE / "fonts" / "Inter-VariableFont_opsz,wght.ttf"

_ECC = {"M": ERROR_CORRECT_M, "Q": ERROR_CORRECT_Q, "H": ERROR_CORRECT_H}


def get_font(size: float, weight: int) -> ImageFont.FreeTypeFont:
    """Load Inter at a given size and variable-font weight (100–900)."""
    font = ImageFont.truetype(str(INTER_PATH), size=size)
    opsz = max(14.0, min(32.0, float(size)))
    font.set_variation_by_axes([opsz, float(weight)])
    return font


def text_width(font: ImageFont.FreeTypeFont, text: str) -> float:
    return float(font.getlength(text))


def wrap_text(text: str, font: ImageFont.FreeTypeFont, max_width: float) -> list[str]:
    words = text.split()
    if not words:
        return [""]
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        trial = f"{current} {word}"
        if text_width(font, trial) <= max_width:
            current = trial
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def any_word_overflows(text: str, font: ImageFont.FreeTypeFont, max_width: float) -> bool:
    return any(text_width(font, word) > max_width for word in text.split())


def _headline_score(
    size: int, lines: list[str], max_width: float, font: ImageFont.FreeTypeFont
) -> float:
    """Prefer large type, but avoid awkward wraps like a single mid-line word."""
    widths = [text_width(font, ln) for ln in lines]
    n = len(lines)
    score = float(size)
    # A 2-line wrap is worth a modest size drop; a 1-line wrap a bit more.
    score += (3 - n) * 8
    # Penalize a single-word line that isn't the whole name (e.g. "International"
    # sitting alone between "Ninoy Aquino" and "Airport Terminal 3").
    words_per_line = [len(ln.split()) for ln in lines]
    if n > 1:
        for i, count in enumerate(words_per_line):
            if count == 1 and not (n == 2 and i == 1):
                # Allow a short last line ("Terminal 3" is two words anyway);
                # penalize a lone mid-line word, and a lone first line of a 3-line wrap.
                if i < n - 1:
                    # Must beat an 11–16px size advantage so a cleaner wrap wins
                    # even when the taller size still fits the box.
                    score -= 18
    # Prefer more even line widths so the block looks like a solid rag.
    if n > 1 and max(widths) > 0:
        avg = sum(widths) / n
        ragged = (sum((w - avg) ** 2 for w in widths) / n) ** 0.5 / max_width
        score -= ragged * 12
    return score


def fit_headline(
    text: str,
    max_width: float,
    max_height: float,
    max_size: int = HEADLINE_MAX_SIZE,
    min_size: int = HEADLINE_MIN_SIZE,
    max_lines: int = HEADLINE_MAX_LINES,
) -> tuple[ImageFont.FreeTypeFont, list[str], float, int]:
    """Pick a font size and wrap that fits the box without overflowing.

    Returns (font, lines, line_height_px, font_size).
    Scores candidates so a slightly smaller size with a cleaner wrap can win
    over a larger size that leaves a single word on its own line.
    """
    candidates: list[tuple[float, ImageFont.FreeTypeFont, list[str], float, int]] = []
    floor = 28
    for size in range(max_size, floor - 1, -1):
        font = get_font(size, 800)
        if any_word_overflows(text, font, max_width):
            continue
        lines = wrap_text(text, font, max_width)
        if len(lines) > max_lines:
            continue
        line_h = size * HEADLINE_LINE_HEIGHT
        total_h = line_h * len(lines)
        if total_h > max_height:
            continue
        score = _headline_score(size, lines, max_width, font)
        # Below min_size, only accept if nothing larger worked.
        if size < min_size:
            score -= 40
        candidates.append((score, font, lines, line_h, size))

    if candidates:
        _score, font, lines, line_h, size = max(candidates, key=lambda c: c[0])
        return font, lines, line_h, size

    # Last resort: min floor, force max_lines by character-wrapping if needed.
    font = get_font(floor, 800)
    lines = wrap_text(text, font, max_width)
    if len(lines) > max_lines:
        kept = lines[:max_lines]
        last = kept[-1]
        ell = "…"
        while last and text_width(font, last + ell) > max_width:
            last = last[:-1].rstrip()
        kept[-1] = (last + ell) if last else ell
        lines = kept
    return font, lines, floor * HEADLINE_LINE_HEIGHT, floor


def make_gradient(width: int, height: int) -> Image.Image:
    """Diagonal gradient matching the app icon / adaptive-icon background."""
    xs = np.linspace(0.0, 1.0, width, dtype=np.float32)
    ys = np.linspace(0.0, 1.0, height, dtype=np.float32)
    # Same diagonal interpolation used in the 1024x1024 brand background.
    t = (xs[None, :] + ys[:, None]) / 2.0
    t = t[..., None]
    start = np.array(GRAD_TOP_LEFT, dtype=np.float32)
    end = np.array(GRAD_BOTTOM_RIGHT, dtype=np.float32)
    arr = (start + (end - start) * t).round().astype(np.uint8)
    return Image.fromarray(arr, mode="RGB")


def make_map_overlay(width: int, height: int, pin_cx: float, pin_cy: float) -> Image.Image:
    """Subtle street-grid + radar rings, drawn in code (no stock photos)."""
    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Irregular city-block streets, slightly brighter for a few "avenues".
    v_streets = [36, 118, 198, 274, 362, 448, 538, 622, 708, 792, 884, 968, 1058, 1148]
    h_streets = [24, 108, 186, 268, 348, 432, 512, 594]
    avenues_x = {198, 538, 884}
    avenues_y = {186, 432}

    minor = (*WHITE, 22)
    major = (*WHITE, 38)

    for x in v_streets:
        color = major if x in avenues_x else minor
        width_px = 3 if x in avenues_x else 1
        draw.line([(x, 0), (x, height)], fill=color, width=width_px)
    for y in h_streets:
        color = major if y in avenues_y else minor
        width_px = 3 if y in avenues_y else 1
        draw.line([(0, y), (width, y)], fill=color, width=width_px)

    # One diagonal avenue, like a boulevard crossing the grid.
    draw.line([(-40, 520), (1280, 80)], fill=(*WHITE, 26), width=2)

    # Radar / location rings centered on the decorative pin.
    for r, alpha in ((70, 28), (130, 22), (200, 16), (280, 11)):
        bbox = [pin_cx - r, pin_cy - r, pin_cx + r, pin_cy + r]
        draw.ellipse(bbox, outline=(*WHITE, alpha), width=2)

    # A handful of small "map pin" dots at intersections, very faint.
    dots = [(118, 108), (274, 268), (448, 186), (622, 348), (708, 108), (968, 268), (1058, 512)]
    for x, y in dots:
        draw.ellipse([x - 4, y - 4, x + 4, y + 4], fill=(*WHITE, 40))
        draw.ellipse([x - 9, y - 9, x + 9, y + 9], outline=(*WHITE, 24), width=1)

    return overlay


def rounded_icon(icon: Image.Image, size: int, radius: int) -> Image.Image:
    """Scale the app icon and apply rounded corners."""
    icon = icon.convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size, size), radius=radius, fill=255)
    icon.putalpha(mask)
    return icon


def drop_shadow(
    img: Image.Image,
    offset: tuple[int, int] = (0, 8),
    blur: int = 16,
    color: tuple[int, int, int, int] = (0, 0, 0, 90),
) -> Image.Image:
    """Return img composited onto a blurred drop shadow, same canvas size grown by blur."""
    ox, oy = offset
    pad = blur * 2
    w, h = img.size
    canvas = Image.new("RGBA", (w + pad * 2 + abs(ox), h + pad * 2 + abs(oy)), (0, 0, 0, 0))
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sx = pad + max(ox, 0)
    sy = pad + max(oy, 0)
    # Build a silhouette in the shadow color.
    alpha = img.split()[-1]
    sil = Image.new("RGBA", img.size, color)
    sil.putalpha(alpha.point(lambda a: int(a * color[3] / 255)))
    shadow.paste(sil, (sx + ox, sy + oy), sil)
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur))
    shadow.paste(img, (sx, sy), img)
    return shadow


def draw_text_with_shadow(
    base: Image.Image,
    xy: tuple[float, float],
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int, int] | tuple[int, int, int],
    shadow_fill: tuple[int, int, int, int] = (0, 0, 0, 70),
    shadow_offset: tuple[int, int] = (0, 2),
    anchor: str = "la",
) -> None:
    """Draw text onto an RGBA image with a short, soft shadow for contrast."""
    # Shadow on a tiny overlay so it can be blurred slightly without smearing the glyph.
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    sx, sy = shadow_offset
    x, y = xy
    d.text((x + sx, y + sy), text, font=font, fill=shadow_fill, anchor=anchor)
    overlay = overlay.filter(ImageFilter.GaussianBlur(1.2))
    base.alpha_composite(overlay)
    ImageDraw.Draw(base).text((x, y), text, font=font, fill=fill, anchor=anchor)


def load_play_badge(asset_path: Path, asset_height: int) -> Image.Image:
    """Scale the official badge uniformly. No crop, recolor, or rearranging."""
    badge = Image.open(asset_path).convert("RGBA")
    if badge.size != BADGE_ASSET_SIZE:
        # Still scale uniformly from whatever official file we have.
        pass
    w, h = badge.size
    new_h = asset_height
    new_w = int(round(w * (new_h / h)))
    return badge.resize((new_w, new_h), Image.Resampling.LANCZOS)


def make_play_qr(
    url: str = PLAY_LISTING_URL,
    size: int = QR_SIZE,
    error: str = QR_ERROR,
) -> Image.Image:
    """Black-on-white QR with a 4-module quiet zone, scaled with nearest-neighbor."""
    qr = qrcode.QRCode(
        error_correction=_ECC[error],
        border=QR_BORDER_MODULES,
        box_size=1,
    )
    qr.add_data(url)
    qr.make(fit=True)
    native = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    # NEAREST keeps modules as solid black/white squares (no gray fringe).
    return native.resize((size, size), Image.Resampling.NEAREST)


def qr_plate(qr: Image.Image, extra_pad: int = 8, radius: int = 10) -> Image.Image:
    """Sit the QR on a slightly larger white rounded plate (quiet zone stays white).

    extra_pad is *outside* the required 4-module quiet zone already in `qr`.
    Corner radius is kept small so it cannot eat into the quiet zone.
    """
    w, h = qr.size
    side = w + extra_pad * 2
    plate = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    ImageDraw.Draw(plate).rounded_rectangle(
        [0, 0, side - 1, side - 1], radius=radius, fill=(255, 255, 255, 255)
    )
    plate.paste(qr.convert("RGBA"), (extra_pad, extra_pad))
    return plate


def render_og_image(
    place: str,
    icon_path: Path = DEFAULT_ICON,
    pin_path: Path = DEFAULT_PIN,
    badge_path: Path = DEFAULT_BADGE,
    label: str = "Parking near",
) -> Image.Image:
    """Render one 1200x630 Open Graph image.

    `place` is the big headline; `label` is the small line above it
    ("" for the site-wide image, whose headline is the whole message).
    """
    place = " ".join(place.split())  # normalize whitespace
    if not place:
        raise ValueError("place name must not be empty")

    canvas = make_gradient(WIDTH, HEIGHT).convert("RGBA")

    # --- CTA geometry first, so the pin and headline can stay out of its way.
    qr = make_play_qr()
    plate = qr_plate(qr, extra_pad=10, radius=6)
    plate_size = plate.size[0]
    qr_x = WIDTH - MARGIN_X - plate_size
    qr_y = HEIGHT - MARGIN_Y - plate_size

    badge = load_play_badge(badge_path, BADGE_ASSET_HEIGHT)
    badge_w, badge_h = badge.size
    promo_font = get_font(22, 600)
    promo_h = 22
    gap_promo_to_badge = 2  # official asset already includes 1/4-height clear space
    cta_h = promo_h + gap_promo_to_badge + badge_h
    gap_badge_to_qr = 20
    cta_x = qr_x - gap_badge_to_qr - badge_w
    # Align the promo+badge stack to the bottom of the QR plate so the
    # left typography keeps as much vertical room as possible.
    cta_y = qr_y + max(0, plate_size - cta_h)

    promo_y = cta_y
    badge_x = cta_x
    badge_y = cta_y + promo_h + gap_promo_to_badge

    # Decorative pin: smaller, upper-right, fully above the QR plate.
    pin_src = Image.open(pin_path).convert("RGBA")
    pin_h = 300
    pin_w = int(pin_src.width * (pin_h / pin_src.height))
    pin = pin_src.resize((pin_w, pin_h), Image.Resampling.LANCZOS)
    # Align the pin with the QR column; keep a gap above the plate.
    pin_x = qr_x + (plate_size - pin_w) / 2
    pin_y = MARGIN_Y
    # If the pin would collide with the QR, slide it up (it already starts at
    # the top margin) or shrink — the 300px height is chosen to clear the plate.
    if pin_y + pin_h > qr_y - 16:
        pin_h = max(200, int(qr_y - 16 - pin_y))
        pin_w = int(pin_src.width * (pin_h / pin_src.height))
        pin = pin_src.resize((pin_w, pin_h), Image.Resampling.LANCZOS)
        pin_x = qr_x + (plate_size - pin_w) / 2
    pin_cx = pin_x + pin_w / 2
    pin_cy = pin_y + pin_h * 0.48

    # Soft glow behind the pin so it lifts off the grid.
    glow = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    for r, a in ((150, 50), (100, 40), (60, 30)):
        gdraw.ellipse(
            [pin_cx - r, pin_cy - r, pin_cx + r, pin_cy + r],
            fill=(1, 90, 200, a),
        )
    glow = glow.filter(ImageFilter.GaussianBlur(22))
    canvas.alpha_composite(glow)

    canvas.alpha_composite(make_map_overlay(WIDTH, HEIGHT, pin_cx, pin_cy))

    canvas.paste(pin, (int(pin_x), int(pin_y)), pin)

    # --- Header: app icon + wordmark -------------------------------------------------
    icon_size = 68
    icon = rounded_icon(Image.open(icon_path), icon_size, radius=16)
    icon_shadowed = drop_shadow(icon, offset=(0, 6), blur=12, color=(0, 0, 0, 80))
    header_x = MARGIN_X
    header_y = MARGIN_Y
    shadow_pad = 12 * 2  # blur * 2
    canvas.alpha_composite(
        icon_shadowed, (header_x - shadow_pad, header_y - shadow_pad)
    )

    wordmark_font = get_font(34, 700)
    wordmark_x = header_x + icon_size + 18
    wordmark_y = header_y + icon_size / 2  # vertical center with icon
    draw_text_with_shadow(
        canvas,
        (wordmark_x, wordmark_y),
        "Where To Park",
        wordmark_font,
        fill=WHITE,
        shadow_fill=(0, 0, 0, 60),
        shadow_offset=(0, 1),
        anchor="lm",
    )

    # --- Headline + subline, in the band below the header and above the CTA ----------
    band_top = header_y + icon_size + 24
    # The QR lives in the right column; the left typography is only limited
    # by the promo/badge row under it.
    band_bottom = cta_y - 20
    band_height = band_bottom - band_top

    # Headline sits above the CTA, so it only has to clear the pin on the
    # right — not the badge, which is lower on the canvas.
    text_max_w = pin_x - MARGIN_X - 28
    text_max_w = max(text_max_w, 560)

    label_font = get_font(28, 550)
    label_h = 28 if label else 0

    subline_font = get_font(22, 500)
    subline_h = 22
    gap_label_to_place = 10 if label else 0
    gap_place_to_subline = 18
    place_max_h = (
        band_height - label_h - gap_label_to_place - gap_place_to_subline - subline_h
    )

    place_font, place_lines, place_line_h, place_size = fit_headline(
        place, text_max_w, place_max_h
    )
    last_render_info["place"] = place
    last_render_info["font_size"] = place_size
    last_render_info["lines"] = list(place_lines)
    last_render_info["text_max_w"] = round(text_max_w, 1)
    last_render_info["qr_box"] = (int(qr_x), int(qr_y), plate_size)
    last_render_info["badge_box"] = (int(badge_x), int(badge_y), badge_w, badge_h)
    last_render_info["visible_badge_h"] = round(badge_h * BADGE_CONTENT_SIZE[1] / BADGE_ASSET_SIZE[1], 1)
    place_block_h = place_line_h * len(place_lines)

    stack_h = (
        label_h + gap_label_to_place + place_block_h + gap_place_to_subline + subline_h
    )
    # Top-align the typographic stack so short names sit under the header
    # instead of floating in the middle, and long names keep the room they need.
    stack_y = band_top

    label_y = stack_y
    if label:
        draw_text_with_shadow(
            canvas,
            (MARGIN_X, label_y),
            label,
            label_font,
            fill=TEXT_MUTED,
            shadow_fill=(0, 0, 0, 50),
            shadow_offset=(0, 1),
            anchor="lt",
        )

    place_y = label_y + label_h + gap_label_to_place
    for i, line in enumerate(place_lines):
        y = place_y + i * place_line_h
        draw_text_with_shadow(
            canvas,
            (MARGIN_X, y),
            line,
            place_font,
            fill=WHITE,
            shadow_fill=(0, 0, 0, 80),
            shadow_offset=(0, 2),
            anchor="lt",
        )

    # Green accent bar + subline, sitting under the place name.
    sub_y = place_y + place_block_h + gap_place_to_subline
    accent_w, accent_h = 28, 4
    accent_y = sub_y + (subline_h - accent_h) / 2 + 2
    ImageDraw.Draw(canvas).rounded_rectangle(
        [MARGIN_X, accent_y, MARGIN_X + accent_w, accent_y + accent_h],
        radius=2,
        fill=(*PIN_GREEN, 255),
    )
    draw_text_with_shadow(
        canvas,
        (MARGIN_X + accent_w + 14, sub_y),
        SUBLINE,
        subline_font,
        fill=TEXT_MUTED,
        shadow_fill=(0, 0, 0, 50),
        shadow_offset=(0, 1),
        anchor="lt",
    )

    # --- Play Store CTA: promo line + official badge + QR ---------------------------
    draw_text_with_shadow(
        canvas,
        (badge_x, promo_y),
        PROMO_LINE,
        promo_font,
        fill=WHITE,
        shadow_fill=(0, 0, 0, 50),
        shadow_offset=(0, 1),
        anchor="lt",
    )
    # Badge is official artwork, composited as-is (uniformly scaled only).
    canvas.alpha_composite(badge, (int(badge_x), int(badge_y)))

    # Soft shadow under the white QR plate, then the plate itself.
    plate_shadowed = drop_shadow(plate, offset=(0, 6), blur=10, color=(0, 0, 0, 70))
    sh_pad = 10 * 2
    canvas.alpha_composite(
        plate_shadowed, (int(qr_x) - sh_pad, int(qr_y) - sh_pad)
    )

    return canvas.convert("RGB")


def save_png(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="PNG", optimize=True, compress_level=9)


def _try_import_zxing():
    """Load zxing-cpp from a local venv if the system Python doesn't have it."""
    try:
        import zxingcpp
        return zxingcpp
    except ImportError:
        pass
    venv_site = HERE / ".venv" / "lib" / f"python{sys.version_info.major}.{sys.version_info.minor}" / "site-packages"
    if venv_site.exists() and str(venv_site) not in sys.path:
        sys.path.insert(0, str(venv_site))
    try:
        import zxingcpp
        return zxingcpp
    except ImportError:
        return None


def decode_qr(img: Image.Image) -> tuple[str, str]:
    """Decode a QR from a PIL image. Returns (text, decoder_name).

    Prefers zxing-cpp (more reliable at Facebook preview sizes) and
    falls back to OpenCV's QRCodeDetector.
    """
    rgb = img.convert("RGB")
    zxingcpp = _try_import_zxing()
    if zxingcpp is not None:
        # Some exact preview widths fail the default binarizer but succeed
        # with another; try each so we don't report a false miss.
        binarizers = [zxingcpp.Binarizer.LocalAverage]
        for name in ("GlobalHistogram", "FixedThreshold", "BoolCast"):
            binarizers.append(getattr(zxingcpp.Binarizer, name))
        for binarizer in binarizers:
            codes = zxingcpp.read_barcodes(rgb, binarizer=binarizer)
            for code in codes:
                text = getattr(code, "text", "") or ""
                if text:
                    return text, "zxing-cpp"
    try:
        import cv2

        arr = np.array(rgb)
        bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        value, _pts, _ = cv2.QRCodeDetector().detectAndDecode(bgr)
        if value:
            return value, "opencv"
    except Exception:
        pass
    return "", "none"


def verify_qr(path: Path, expected: str = PLAY_LISTING_URL) -> dict:
    """Decode the QR at full size and at typical Facebook preview widths."""
    src = Image.open(path).convert("RGB")
    # Common display widths for a 1.91:1 link preview (mobile feed, Messenger, etc.).
    preview_widths = (1200, 600, 500, 400, 360)
    results = {}
    for w in preview_widths:
        h = int(round(src.height * (w / src.width)))
        scaled = src if w == src.width else src.resize((w, h), Image.Resampling.LANCZOS)
        value, decoder = decode_qr(scaled)
        results[f"{w}x{h}"] = {
            "ok": value == expected,
            "value": value,
            "decoder": decoder,
        }
    return results


last_render_info: dict = {}


SAMPLES = [
    ("Pasay", "og-pasay.png"),
    ("Ninoy Aquino International Airport Terminal 3", "og-naia-terminal-3.png"),
]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--place", help="Place name to put in the headline")
    parser.add_argument("--out", type=Path, help="Output PNG path")
    parser.add_argument(
        "--samples",
        action="store_true",
        help="Render the two review samples (Pasay and the long NAIA name)",
    )
    parser.add_argument(
        "--default",
        action="store_true",
        help=f"Render the site-wide image ({SITE_HEADLINE!r}) to public/og-image.png",
    )
    parser.add_argument("--icon", type=Path, default=DEFAULT_ICON)
    parser.add_argument("--pin", type=Path, default=DEFAULT_PIN)
    parser.add_argument("--badge", type=Path, default=DEFAULT_BADGE)
    parser.add_argument(
        "--verify-qr",
        action="store_true",
        help="After rendering, decode the QR at full size and Facebook preview sizes",
    )
    args = parser.parse_args(argv)

    rendered: list[Path] = []

    if args.default:
        dest = args.out or SITE_IMAGE
        img = render_og_image(
            SITE_HEADLINE, icon_path=args.icon, pin_path=args.pin, badge_path=args.badge, label=""
        )
        save_png(img, dest)
        size_kb = dest.stat().st_size / 1024
        print(f"{dest}  {img.size[0]}x{img.size[1]}  {size_kb:.1f} KB  lines={last_render_info.get('lines')}")
        if size_kb > 300:
            print("warning: over 300 KB", file=sys.stderr)
        rendered.append(dest)
    elif args.samples:
        out_dir = HERE / "out"
        for place, filename in SAMPLES:
            dest = out_dir / filename
            t0 = time.perf_counter()
            img = render_og_image(
                place, icon_path=args.icon, pin_path=args.pin, badge_path=args.badge
            )
            save_png(img, dest)
            elapsed_ms = (time.perf_counter() - t0) * 1000
            size_kb = dest.stat().st_size / 1024
            info = last_render_info
            print(
                f"{dest}  {img.size[0]}x{img.size[1]}  "
                f"{size_kb:.1f} KB  {elapsed_ms:.0f} ms  place={place!r}  "
                f"font={info.get('font_size')}px  lines={info.get('lines')}"
            )
            rendered.append(dest)
    elif not args.place or not args.out:
        parser.error("provide --place and --out, or use --samples")
    else:
        t0 = time.perf_counter()
        img = render_og_image(
            args.place, icon_path=args.icon, pin_path=args.pin, badge_path=args.badge
        )
        save_png(img, args.out)
        elapsed_ms = (time.perf_counter() - t0) * 1000
        size_kb = args.out.stat().st_size / 1024
        print(
            f"{args.out}  {img.size[0]}x{img.size[1]}  "
            f"{size_kb:.1f} KB  {elapsed_ms:.0f} ms  place={args.place!r}"
        )
        rendered.append(args.out)

    if args.verify_qr:
        for dest in rendered:
            print(f"QR verify {dest}:")
            for label, result in verify_qr(dest).items():
                status = "OK" if result["ok"] else "FAIL"
                value = result["value"] or "(no QR decoded)"
                decoder = result.get("decoder", "")
                print(f"  {label}: {status}  [{decoder}]  {value}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
