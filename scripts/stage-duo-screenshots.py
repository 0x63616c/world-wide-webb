#!/usr/bin/env python3
"""Stage the configured Duo shots for deliver; never publish default-screen fallbacks."""

import json
from pathlib import Path
import sys

from PIL import Image


def stage(config_path, raw, output):
    config = json.loads(Path(config_path).read_text())
    shots = config["duo_shots"]
    # Both displays share APP_IPHONE_DUO's ten-image limit.
    if not isinstance(shots, list) or not 1 <= len(shots) <= 5:
        raise ValueError("duo_shots must contain 1–5 shots (two displays, ten images maximum)")
    raw, output = Path(raw), Path(output)
    plan = json.loads((raw / "plan.json").read_text())
    if plan["mode"] not in ("fold", "displays"):
        raise ValueError(
            "Duo release requires verified inner and outer captures; default-screen fallback cannot be uploaded"
        )
    files = []
    for index, shot in enumerate(shots, 1):
        screen, appearance = shot["screen"], shot["appearance"]
        if screen not in {"home", "treatment", "progress", "journal", "settings", "log-dose"} or appearance not in {
            "light",
            "dark",
        }:
            raise ValueError(f"Invalid Duo shot: {shot}")
        for pose, dimensions in (("inner", (2007, 2853)), ("outer", (1398, 2034))):
            source = raw / f"{pose}-{appearance}-{screen}.png"
            with Image.open(source) as image:
                image.load()
                if image.format != "PNG" or image.size not in (dimensions, dimensions[::-1]):
                    raise ValueError(
                        f"{source}: expected {dimensions[0]}x{dimensions[1]} or {dimensions[1]}x{dimensions[0]} PNG, got {image.format} {image.size}"
                    )
                # Simulator PNGs may have a fully opaque alpha channel; strip it for ASC.
                if image.convert("RGBA").getchannel("A").getextrema() != (255, 255):
                    raise ValueError(f"{source}: screenshot contains transparent pixels")
                if all(low == high for low, high in image.convert("RGB").getextrema()):
                    raise ValueError(f"{source}: blank display capture")
            # Interleave displays in a stable order within the single Duo gallery.
            files.append((source, f"duo-{index:02}-{pose}-{screen}.png"))
    # Validate everything before replacing the previous staged Duo set.
    output.mkdir(parents=True, exist_ok=True)
    for old in output.glob("duo-*.png"):
        old.unlink()
    for source, name in files:
        with Image.open(source) as image:
            image.convert("RGB").save(output / name)
    print(f"Staged {len(files)} Duo screenshots in {output}")


if __name__ == "__main__":
    try:
        stage(*sys.argv[1:])
    except (ValueError, KeyError, OSError) as error:
        sys.exit(str(error))
