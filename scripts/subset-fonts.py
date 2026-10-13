"""
Cuts the brand fonts down to the characters GSend actually shows, as woff2 in
public/fonts, so nothing is fetched from a font service.

The characters come from the message strings (both languages), index.html and the
privacy page. The handwriting face only ever draws the "hand.*" strings, so it gets
just those. Run it again whenever the strings change:

    python scripts/subset-fonts.py <folder with the source fonts>

The folder needs jf-openhuninn-2.1.ttf, Nunito.ttf, TitanOne-Regular.ttf and
LXGWWenKaiTC-Medium.ttf, with their licence files. Needs fontTools and brotli.
"""

import html
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "fonts"
STRINGS = ROOT / "src" / "i18n" / "strings.ts"
PAGES = [ROOT / "index.html", ROOT / "public" / "privacy.html"]

# Printable ASCII and the punctuation the copy uses, kept whatever the strings say.
ALWAYS = "".join(chr(c) for c in range(0x20, 0x7F)) + "，。、：；！？「」『』（）《》—…·→←↑↓↗×　 ‘’“”–"

FONTS = [
    # (source file, output, licence files, character set)
    ("jf-openhuninn-2.1.ttf", "huninn.woff2", ["openhuninn-LICENSE.txt"], "all"),
    ("Nunito.ttf", "Nunito.woff2", ["Nunito-OFL.txt"], "latin"),
    ("TitanOne-Regular.ttf", "TitanOne.woff2", ["TitanOne-OFL.txt"], "digits"),
    ("LXGWWenKaiTC-Medium.ttf", "WenKai.woff2", ["LXGWWenKaiTC-OFL.txt"], "hand"),
]


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
        # Nunito only covers Latin; the Chinese falls through to huninn.
        text = {c for c in text if ord(c) < 0x3000}
    return "".join(sorted(c for c in text if not c.isspace() or c == " "))


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1])
    OUT.mkdir(parents=True, exist_ok=True)
    for font, out, licences, kind in FONTS:
        chars = charset(kind)
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".txt", delete=False) as tf:
            tf.write(chars)
        target = OUT / out
        subprocess.run(
            [
                sys.executable, "-m", "fontTools.subset", str(src / font),
                f"--text-file={tf.name}", "--flavor=woff2", f"--output-file={target}",
                "--layout-features=*", "--no-hinting", "--desubroutinize",
            ],
            check=True,
        )
        Path(tf.name).unlink()
        for licence in licences:
            shutil.copyfile(src / licence, OUT / licence)
        print(f"{out}: {len(chars)} chars, {target.stat().st_size} bytes")


if __name__ == "__main__":
    main()
