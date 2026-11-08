#!/usr/bin/env python3
"""Reproduce legacy monochrome badges outside the app asset catalog.

Current generated color assets and their prompts live in design/badges.
This script preserves the original vector experiment without overwriting them.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "build/legacy-milestone-badges"
# Numerals are drawn paths, so the artwork has no font or remote dependency.
GLYPHS = {
    "0": "M8 0C-2 0-2 24 8 24C18 24 18 0 8 0Z",
    "1": "M2 6L9 0V24M3 24H15",
    "3": "M0 2C18-7 22 12 8 12C24 12 19 31 0 22",
    "7": "M0 0H18L5 24",
    "K": "M0 0V24M17 0L1 12L18 24",
}


def numerals(label):
    step = 24
    width = (len(label) - 1) * step + 18
    return ''.join(
        f'<path transform="translate({64-width/2+index*step:g} 83)" d="{GLYPHS[glyph]}"/>'
        for index, glyph in enumerate(label)
    )


def render(label, days):
    if days:
        outline = '<rect x="13" y="16" width="102" height="101" rx="17"/><path d="M13 45H115M38 10V28M90 10V28M36 62H42M61 62H67M86 62H92"/>'
    else:
        outline = '<path d="M64 8L114 30V86Q114 111 64 122Q14 111 14 86V30Z"/><path d="M64 35L91 28V66L64 73L37 66V28Z M64 35V73"/>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><g fill="none" stroke="#000" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">{outline}{numerals(label)}</g></svg>\n'


def main():
    for badge, label in [("folds_1", "1"), ("folds_100", "100"), ("folds_1000", "1K"),
                         ("folds_10000", "10K"), ("days_7", "7"), ("days_30", "30")]:
        folder = DESTINATION / f"badge_{badge}.imageset"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "badge.svg").write_text(render(label, badge.startswith("days")))
        contents = {
            "images": [{"filename": "badge.svg", "idiom": "universal"}],
            "info": {"author": "xcode", "version": 1},
            "properties": {"preserves-vector-representation": True, "template-rendering-intent": "template"},
        }
        (folder / "Contents.json").write_text(json.dumps(contents, indent=2) + "\n")


if __name__ == "__main__":
    main()
