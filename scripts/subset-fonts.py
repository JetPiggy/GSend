"""
Cuts the brand fonts down to the characters GSend actually shows, as woff2 in
public/fonts, so nothing is fetched from a font service.

The characters come from the message strings (both languages), index.html and the
privacy page. The handwriting face only ever draws the "hand.*" strings, so it gets
just those. Run it again whenever the strings change:

    python scripts/subset-fonts.py <folder with the source fonts>

The folder needs jf-openhuninn-2.1.ttf, Nunito.ttf, TitanOne-Regular.ttf and
LXGWWenKaiTC-Medium.ttf, with their licence files. Needs fontTools and brotli.

All four are under the SIL Open Font License, which counts a subset as a Modified
Version (OFL FAQ 2.6), and a Modified Version may not go by a Reserved Font Name. So
the fonts whose licences reserve their names get names of their own, which the CSS
uses too: jf open huninn becomes "GSend UI" and Titan One "GSend Digits". Their
copyright, trademark and licence notices stay as they are.
"""

import html
import re
import shutil
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "fonts"
STRINGS = ROOT / "src" / "i18n" / "strings.ts"
PAGES = [ROOT / "index.html", ROOT / "public" / "privacy.html"]

# Printable ASCII and the punctuation the copy uses, kept whatever the strings say.
ALWAYS = "".join(chr(c) for c in range(0x20, 0x7F)) + "，。、：；！？「」『』（）《》—…·→←↑↓↗×　 ‘’“”–"

FONTS = [
    # (source file, output, licence files, character set)
    ("jf-openhuninn-2.1.ttf", "GSendUI.woff2", ["openhuninn-LICENSE.txt"], "all"),
    ("Nunito.ttf", "Nunito.woff2", ["Nunito-OFL.txt"], "latin"),
    ("TitanOne-Regular.ttf", "GSendDigits.woff2", ["TitanOne-OFL.txt"], "digits"),
    ("LXGWWenKaiTC-Medium.ttf", "WenKai.woff2", ["LXGWWenKaiTC-OFL.txt"], "hand"),
]

# The fonts whose licences reserve names: the subset's own name, and the reserved names
# it must not carry. jf open huninn is built on Varela Round, whose reserved names
# carry over.
RENAMED = {
    "jf-openhuninn-2.1.ttf": ("GSend UI", ["open huninn", "huninn", "Varela", "Varela Round"]),
    "TitanOne-Regular.ttf": ("GSend Digits", ["Titan", "Titan One"]),
}

# The name records a subset keeps: the names (1-6) and the copyright (0), trademark (7)
# and licence (13, 14) notices. The OFL wants every copy of a font to carry its
# copyright notice and licence, and its FAQ (3.7) wants trademark notices kept.
NAME_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 13, 14]
# The copyright and trademark notices name the original font, as they must.
NOTICES = {0, 7}


def string_values(source: str, prefix: str = "") -> str:
    """Every string literal value in strings.ts, optionally only for keys with a prefix."""
    # Escapes such as \n stay as written: only which characters appear matters here.
    pairs = re.findall(r'"([a-z]+\.[\w.-]+)":\s*"((?:[^"\\]|\\.)*)"', source)
    return "".join(value for key, value in pairs if key.startswith(prefix))


def page_text(path: Path) -> str:
    s = path.read_text(encoding="utf-8")
    s = re.sub(r"<style.*?</style>", " ", s, flags=re.S)
    s = re.sub(r"<script.*?</script>", " ", s, flags=re.S)
    attrs = re.findall(r'(?:alt|title|aria-label|content|placeholder)="([^"]*)"', s)
    s = re.sub(r"<[^>]+>", " ", s)
    return html.unescape(s) + "".join(html.unescape(a) for a in attrs)


def charset(kind: str) -> str:
    source = STRINGS.read_text(encoding="utf-8")
    if kind == "digits":
        return "0123456789"
    if kind == "hand":
        text = set(string_values(source, "hand.")) | set(ALWAYS)
    else:
        text = set(string_values(source)) | set(ALWAYS)
        for page in PAGES:
            text |= set(page_text(page))
    if kind == "latin":
        # Nunito only covers Latin; the Chinese falls through to GSend UI.
        text = {c for c in text if ord(c) < 0x3000}
    return "".join(sorted(c for c in text if not c.isspace() or c == " "))


def reserves_names(font: TTFont, src: Path, licences: list[str]) -> bool:
    """Whether the copyright notice, in the font or atop a licence file, reserves names."""
    notices = [font["name"].getDebugName(0) or ""]
    for name in licences:
        # A licence file starts with the copyright notice, then the OFL text itself.
        text = (src / name).read_text(encoding="utf-8")
        notices.append(text.split("SIL OPEN FONT LICENSE")[0])
    return any("Reserved Font Name" in notice for notice in notices)


def rename(font: TTFont, family: str) -> None:
    """Gives a subset its own name in every record that names the font."""
    name = font["name"]
    postscript = family.replace(" ", "") + "-Regular"
    names = {1: family, 3: f"{name.getDebugName(5)};{postscript}", 4: family, 6: postscript}
    name.names = [record for record in name.names if record.nameID not in names]
    for name_id, value in names.items():
        name.setName(value, name_id, 3, 1, 0x409)


def check_names(font: TTFont, source: str, reserved: list[str]) -> None:
    """Stops if any record but the copyright and trademark notices still carries a reserved name."""

    def squash(s: str) -> str:
        return re.sub(r"[\s_-]", "", s).lower()

    for record in font["name"].names:
        if record.nameID in NOTICES:
            continue
        for word in reserved:
            if squash(word) in squash(record.toUnicode()):
                sys.exit(f"{source}: name record {record.nameID} still carries {word!r}")


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1])
    OUT.mkdir(parents=True, exist_ok=True)
    for font, out, licences, kind in FONTS:
        chars = charset(kind)
        options = subset.Options(
            flavor="woff2", layout_features=["*"], hinting=False, desubroutinize=True,
            name_IDs=NAME_IDS,
        )
        ttf = subset.load_font(str(src / font), options, dontLoadGlyphNames=True)
        if font not in RENAMED and reserves_names(ttf, src, licences):
            sys.exit(f"{font}: its licence reserves font names; give it a name in RENAMED")
        subsetter = subset.Subsetter(options)
        subsetter.populate(text=chars)
        subsetter.subset(ttf)
        if font in RENAMED:
            family, reserved = RENAMED[font]
            rename(ttf, family)
            check_names(ttf, font, reserved)
        target = OUT / out
        subset.save_font(ttf, str(target), options)
        for licence in licences:
            shutil.copyfile(src / licence, OUT / licence)
        print(f"{out}: {len(chars)} chars, {target.stat().st_size} bytes")


if __name__ == "__main__":
    main()
