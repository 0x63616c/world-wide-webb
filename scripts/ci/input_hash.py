#!/usr/bin/env python3
"""Hash a unit's committed delivery bytes, independent of unrelated source changes."""

import argparse
import hashlib
import importlib.util
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("unit_selection", Path(__file__).with_name("select_units.py"))
selection = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(selection)


def input_hash(unit_name, source, repository=ROOT, configuration=None):
    if not re.fullmatch(r"[0-9a-f]{40}", source):
        raise ValueError("Source must be a full commit SHA")
    config = configuration or json.loads(selection.CONFIG.read_text())
    unit = selection.validate(config)["units"][unit_name]
    paths = (
        subprocess.check_output(["git", "ls-tree", "-r", "-z", source], cwd=repository, stderr=subprocess.PIPE)
        .decode()
        .split("\0")
    )
    entries = [entry.split("\t", 1) for entry in paths if entry]
    # Preserve pre-import Folding release readers while normalizing source paths.
    legacy = unit_name.startswith("folding.") and not any(path.startswith("apps/folding/") for _, path in entries)
    files = []
    for metadata, path in entries:
        normalized = "apps/folding/" + path if legacy else path
        if (
            not selection.documentation(normalized)
            and selection.matches(normalized, unit.get("delivery_paths", unit["paths"]))
            and not selection.matches(normalized, unit.get("delivery_exclude", []))
        ):
            files.append([normalized, metadata])
    if not files:
        raise ValueError("No committed product delivery inputs")
    return hashlib.sha256(json.dumps(sorted(files), separators=(",", ":")).encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("unit")
    parser.add_argument("source")
    args = parser.parse_args()
    print(input_hash(args.unit, args.source))


if __name__ == "__main__":
    main()
