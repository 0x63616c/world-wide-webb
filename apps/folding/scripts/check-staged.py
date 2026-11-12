#!/usr/bin/env python3
"""Check staged Swift/OpenTofu blobs without modifying files or the Git index."""

from pathlib import Path
import subprocess
import tempfile
import sys

root = Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip())
paths = subprocess.check_output(["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], cwd=root).split(
    b"\0"
)
failed = False
with tempfile.TemporaryDirectory(prefix="folding-staged-") as temporary:
    for raw in paths:
        if not raw:
            continue
        path = Path(raw.decode())
        if path.suffix not in {".swift", ".tf"}:
            continue
        target = Path(temporary) / path
        target.parent.mkdir(parents=True, exist_ok=True)
        blob = subprocess.check_output(["git", "show", ":" + str(path)], cwd=root)
        target.write_bytes(blob)
        command = (
            ["swift", "format", "lint", "--strict", str(target)]
            if path.suffix == ".swift"
            else ["tofu", "fmt", "-check", str(target)]
        )
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode:
            failed = True
            print(f"Formatting check failed: {path}", file=sys.stderr)
            print((result.stdout + result.stderr).replace(str(target), str(path)), file=sys.stderr)
            print("Run scripts/format, inspect changes, then stage the intended edits.", file=sys.stderr)
sys.exit(1 if failed else 0)
