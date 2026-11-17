# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow==12.0.0"]
# ///
"""Build the studio splash sprite sheets and manifest from their design sources.

Run from anywhere: `uv run packages/StudioSplash/Design/generate.py`.
The globe comes from `globe.aseprite` (exported with the Aseprite CLI); the wordmark and the
loading bars are drawn here. Every sheet uses three colours on transparency, whole pixels only,
and the script refuses to write if a bar moves more than 1 px between frames.
"""

import base64
import json
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

DESIGN = Path(__file__).resolve().parent
OUT = DESIGN.parent / "Sheets"
EMBEDDED = DESIGN.parent / "Sources" / "StudioSplash" / "EmbeddedSheets.swift"
ASEPRITE = shutil.which("aseprite") or "/Applications/Aseprite.app/Contents/MacOS/aseprite"

WHITE = (235, 237, 233, 255)
SLATE = (32, 46, 55, 255)

# Wordmark: WORLD WIDE WEBB in a 5 px capital font, 1 px between letters, 3 px between words.
GLYPHS = {
    "W": ["#...#", "#...#", "#.#.#", "#.#.#", ".#.#."],
    "O": [".##.", "#..#", "#..#", "#..#", ".##."],
    "R": ["###.", "#..#", "###.", "#.#.", "#..#"],
    "L": ["#..", "#..", "#..", "#..", "###"],
    "D": ["###.", "#..#", "#..#", "#..#", "###."],
    "I": ["#", "#", "#", "#", "#"],
    "E": ["###", "#..", "##.", "#..", "###"],
    "B": ["###.", "#..#", "###.", "#..#", "###."],
}

# Bars share one 2 s loop at 50 fps with the wordmark wave, so a fill and its letter hops stay
# in step. The bar is as wide as the wordmark: a 1 px outline around 63 x 3 px inside.
FPS, FRAMES = 50, 100
BAR_W, BAR_H = 65, 5
INSIDE = BAR_W - 2
GROW_FRAMES, HOLD_FRAMES = 80, 10  # fills grow for 1.6 s, stay full for 0.2 s, then clear


def wordmark():
    letters, x = [], 0
    for word in ("WORLD", "WIDE", "WEBB"):
        for ch in word:
            width = len(GLYPHS[ch][0])
            letters.append((ch, x, x + width - 1))
            x += width + 1
        x += 2
    image = Image.new("RGBA", (x - 3, 5))
    for ch, x0, _ in letters:
        for y, row in enumerate(GLYPHS[ch]):
            for i, cell in enumerate(row):
                if cell == "#":
                    image.putpixel((x0 + i, y), WHITE)
    return image, [[x0, x1] for _, x0, x1 in letters]


def stripes(x, r, k):
    return (x - r - k) % 4 < 2


def thin_chevron(x, r, k):
    return (x - (1 - abs(r - 1)) - k) % 4 == 0


def bold_chevron(x, r, k):
    return (x - (1 - abs(r - 1)) - k) % 6 < 2


def scroll(frame, speed):
    return frame * speed // FPS


def fill_length(frame, width):
    if frame >= GROW_FRAMES + HOLD_FRAMES:
        return 0
    return min(width, frame * width // GROW_FRAMES + 1)


def draw_inside(image, frame, pattern, speed, columns):
    k = scroll(frame, speed)
    for x in columns:
        for r in range(3):
            if pattern(x, r, k):
                image.putpixel((1 + x, 1 + r), WHITE)


def bar_variants(letters):
    """Each variant returns (image, leading x or None) for a frame; None means the wave runs on its own."""

    def scrolling(pattern, speed):
        def draw(image, frame):
            draw_inside(image, frame, pattern, speed, range(INSIDE))
            return None

        return draw

    def filling(pattern, edge=False):
        def draw(image, frame):
            n = fill_length(frame, INSIDE)
            draw_inside(image, frame, pattern, 24, range(n))
            growing = 0 < n < INSIDE
            if edge and growing:
                for r in range(3):
                    image.putpixel((n, 1 + r), WHITE)
            return n if growing else None

        return draw

    def line_fill(image, frame):
        n = fill_length(frame, INSIDE - 2)
        for x in range(n):
            image.putpixel((2 + x, 2), WHITE)
        return 1 + n if 0 < n < INSIDE - 2 else None

    def dashes(image, frame):
        k = scroll(frame, 25)
        for x in range(INSIDE - 2):
            if (x - k) % 5 < 3:
                image.putpixel((2 + x, 2), WHITE)
        return None

    # One chevron per letter: 13 chevrons, 3 px wide with 2 px between, fill the inside exactly.
    def chevron_steps(image, frame):
        if frame >= GROW_FRAMES + HOLD_FRAMES:
            return ("letter", None)
        shown = min(len(letters), frame * len(letters) // GROW_FRAMES + 1)
        for i in range(shown):
            for x in range(3):
                for r in range(3):
                    if x - (1 - abs(r - 1)) in (0, 1):
                        image.putpixel((1 + 5 * i + x, 1 + r), WHITE)
        return ("letter", shown - 1 if frame < GROW_FRAMES else None)

    return [
        ("thin-chevrons", "Thin chevrons scrolling right", scrolling(thin_chevron, 24)),
        ("bold-chevrons", "Bold chevrons scrolling right", scrolling(bold_chevron, 24)),
        ("chevron-fill", "Bold chevrons fill to the end, then clear", filling(bold_chevron)),
        ("chevron-fill-edge", "Chevron fill with a solid leading edge", filling(bold_chevron, edge=True)),
        ("chevron-steps", "One chevron appears per letter", chevron_steps),
        ("stripe-fill", "Diagonal stripes fill to the end, then clear", filling(stripes)),
        ("line-fill", "A 1 px line fills to the end, then clears", line_fill),
        ("dashes", "Dashes march right along a 1 px line", dashes),
    ]


def free_wave(frame, count):
    """The wordmark wave when no fill drives it: one letter after another, each up for 120 ms."""
    for i in range(count):
        start = round(i * FPS / 8)
        if start <= frame < start + 6:
            return i
    return -1


def letter_at(x, letters):
    # Bar and wordmark share their left edge, so bar x is wordmark x.
    return next((i for i, (a, b) in enumerate(letters) if a <= x <= b), -1)


def lit(image):
    return {(x, y) for y in range(image.height) for x in range(image.width) if image.getpixel((x, y))[3]}


def inside_columns(image):
    """Lit inside pixels as (column, row), outline excluded."""
    return {(x - 1, y - 1) for x, y in lit(image) if 0 < x < BAR_W - 1 and 0 < y < BAR_H - 1}


def check_bar(name, frames, stepped, gaps=False):
    for frame, image in enumerate(frames):
        if not {image.getpixel(p) for p in lit(image)} <= {WHITE, SLATE}:
            sys.exit(f"{name} frame {frame}: off-palette pixels")
    if stepped:
        return
    for frame in range(FRAMES):
        a, b = inside_columns(frames[frame]), inside_columns(frames[(frame + 1) % FRAMES])
        if not b or b <= a:
            continue  # unchanged, cleared or shrinking back to the start
        front_a = max((x for x, _ in a), default=-1)
        front_b = max(x for x, _ in b)
        # A gappy pattern (chevron-fill) shows its front jumping over the gaps it reveals.
        if not gaps and front_b > front_a + 1 and front_a >= 0 and front_b < INSIDE - 1:
            sys.exit(f"{name} frame {frame}: the fill grows more than 1 px")
        # Everything else must be the previous frame moved by at most 1 px; only the column a
        # pattern scrolls in from and the new front may hold pixels that were not there before.
        start_b = min(x for x, _ in b)
        new = {(x, r) for x, r in b if x not in (start_b, front_b) and not (gaps and x > front_a)}
        if not any(new <= {(x + s, r) for x, r in a} for s in (0, 1)):
            sys.exit(f"{name} frame {frame}: moves more than 1 px")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            ASEPRITE,
            "-b",
            str(DESIGN / "globe.aseprite"),
            "--sheet",
            str(OUT / "globe.png"),
            "--sheet-type",
            "horizontal",
        ],
        check=True,
        capture_output=True,
    )
    globe = Image.open(OUT / "globe.png")
    if globe.size != (41 * 8, 41):
        sys.exit(f"globe sheet is {globe.size}, expected 328x41")

    word, letters = wordmark()
    word.save(OUT / "wordmark.png")

    variants = bar_variants(letters)
    sheet = Image.new("RGBA", (BAR_W * FRAMES, BAR_H * len(variants)))
    manifest_bars = []
    for row, (name, description, draw) in enumerate(variants):
        frames, hops = [], []
        for frame in range(FRAMES):
            image = Image.new("RGBA", (BAR_W, BAR_H))
            for x in range(BAR_W):
                image.putpixel((x, 0), WHITE)
                image.putpixel((x, BAR_H - 1), WHITE)
            for y in range(BAR_H):
                image.putpixel((0, y), WHITE)
                image.putpixel((BAR_W - 1, y), WHITE)
            lead = draw(image, frame)
            if isinstance(lead, tuple):
                hops.append(-1 if lead[1] is None else lead[1])
            elif lead is None:
                hops.append(free_wave(frame, len(letters)) if frame_is_free(name) else -1)
            else:
                hops.append(letter_at(lead, letters))
            frames.append(image)
            sheet.paste(image, (frame * BAR_W, row * BAR_H))
        check_bar(name, frames, stepped=name == "chevron-steps", gaps=name == "chevron-fill")
        manifest_bars.append({"id": name, "description": description, "row": row, "hops": hops})
    sheet.save(OUT / "bars.png")

    # Layout in splash pixels. The globe sheet has an empty row above and below the circle, so
    # it sits at y = -1 to put the visible globe on row 0; 4 px gaps separate the three parts.
    manifest = {
        "version": 1,
        "palette": {"white": "#EBEDE9", "slate": "#202E37"},
        "layout": {
            "width": 65,
            "height": 57,
            "globe": {"x": 12, "y": -1},
            "wordmark": {"x": 0, "y": 43},
            "bar": {"x": 0, "y": 52},
        },
        "globe": {"image": "globe.png", "frameWidth": 41, "frameHeight": 41, "frames": 8, "fps": 8},
        "wordmark": {"image": "wordmark.png", "width": word.width, "height": 5, "hop": 1, "letters": letters},
        "bars": {
            "image": "bars.png",
            "frameWidth": BAR_W,
            "frameHeight": BAR_H,
            "frames": FRAMES,
            "fps": FPS,
            "variants": manifest_bars,
        },
    }
    (OUT / "splash.json").write_text(json.dumps(manifest, indent=2) + "\n")
    write_embedded()
    print(f"wrote {OUT}: globe 8 frames, wordmark {word.width}x5, {len(variants)} bars x {FRAMES} frames")


def write_embedded():
    """Compile the sheets into the Swift package, so apps need no resource bundle to sign."""
    lines = [
        "// Generated by Design/generate.py from Sheets/. Do not edit.",
        "// The sheets are compiled in as base64 so the package has no resource bundle to sign.",
        "enum EmbeddedSheets {",
        "  static let files: [String: String] = [",
    ]
    for name in ("globe.png", "wordmark.png", "bars.png", "splash.json"):
        encoded = base64.b64encode((OUT / name).read_bytes()).decode()
        lines.append(f'    "{name}": "{encoded}",')
    lines += ["  ]", "}", ""]
    EMBEDDED.write_text("\n".join(lines))


def frame_is_free(name):
    return name in {"thin-chevrons", "bold-chevrons", "dashes"}


if __name__ == "__main__":
    main()
