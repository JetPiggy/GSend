"""
Builds the app icons from the pig's face (public/img/face.webp).

The brand icons put the face on a goggle-blue tile; the work-mode favicon has no pig at
all, only a plain arrow on an ink tile, so a browser tab in a meeting shows nothing
playful. Needs Pillow:

    python scripts/make-icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

PUBLIC = Path(__file__).resolve().parent.parent / "public"
FACE = PUBLIC / "img" / "face.webp"

TILE = (0x1F, 0x5F, 0xA8, 255)  # GSend blue, the --blue token in styles.css
INK = (0x16, 0x16, 0x16, 255)
WORK_TILE = (0x1B, 0x1B, 0x1B, 255)  # the work-mode ink

SS = 4  # draw at 4x, then shrink, for clean edges


def face(size: int) -> Image.Image:
    return Image.open(FACE).convert("RGBA").resize((size, size), Image.LANCZOS)


def rounded_mask(size: int, inset: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((inset, inset, size - 1 - inset, size - 1 - inset), radius=radius, fill=255)
    return mask


def tile(size: int, radius: float, fill) -> Image.Image:
    big = size * SS
    im = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(im).rounded_rectangle((0, 0, big - 1, big - 1), radius=round(radius * big), fill=fill)
    return im.resize((size, size), Image.LANCZOS)


def branded(size: int, bleed: bool = False) -> Image.Image:
    """
    The face image is cut flat under the scarf, so the face sits on the bottom edge and
    peeks up rather than floating. A full-bleed icon (iOS rounds its own corners;
    launchers crop maskable icons to a circle) fills the square; the others are a tile
    with an ink border, the face clipped inside it.
    """
    big = size * SS
    border = 0 if bleed else round(0.035 * big)
    radius = round(0.22 * big)
    im = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    if bleed:
        draw.rectangle((0, 0, big, big), fill=TILE)
    else:
        draw.rounded_rectangle((0, 0, big - 1, big - 1), radius=radius, fill=INK)
        draw.rounded_rectangle((border, border, big - 1 - border, big - 1 - border), radius=radius - border, fill=TILE)
    f = face(round(big * (0.78 if bleed else 0.8)))
    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    layer.alpha_composite(f, ((big - f.width) // 2, big - border - f.height))
    if not bleed:
        clip = rounded_mask(big, border, radius - border)
        layer.putalpha(Image.composite(layer.getchannel("A"), Image.new("L", (big, big), 0), clip))
    im.alpha_composite(layer)
    return im.resize((size, size), Image.LANCZOS)


def work_favicon(size: int) -> Image.Image:
    big = size * SS
    im = tile(big, 0.22, WORK_TILE)
    draw = ImageDraw.Draw(im)
    u = big / 32
    # An arrow pointing up and to the right: a stem and a two-stroke head.
    width = round(3.2 * u)
    draw.line((10 * u, 22 * u, 21.5 * u, 10.5 * u), fill="white", width=width)
    draw.line((12.5 * u, 10 * u, 22 * u, 10 * u), fill="white", width=width)
    draw.line((22 * u, 10 * u, 22 * u, 19.5 * u), fill="white", width=width)
    return im.resize((size, size), Image.LANCZOS)


def main() -> None:
    face(32).save(PUBLIC / "favicon-32.png", optimize=True)
    branded(180, bleed=True).convert("RGB").save(PUBLIC / "apple-touch-icon.png", optimize=True)
    branded(192).save(PUBLIC / "icon-192.png", optimize=True)
    branded(512).save(PUBLIC / "icon-512.png", optimize=True)
    branded(512, bleed=True).save(PUBLIC / "icon-maskable-512.png", optimize=True)
    work_favicon(32).save(PUBLIC / "favicon-work-32.png", optimize=True)


if __name__ == "__main__":
    main()
