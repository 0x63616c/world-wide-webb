#!/usr/bin/env python3
"""Format staged files that have a formatter in the maintained CI checks.

The formatted file is staged into the current commit. A file with unstaged edits
is rejected first, so the hook cannot accidentally include those edits.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args])


def paths(data: bytes) -> list[str]:
    return [os.fsdecode(path) for path in data.split(b"\0") if path]


def formatter(path: str) -> list[str] | None:
    if path.endswith(".swift"):
        if shutil.which("xcrun"):
            return ["xcrun", "swift-format", "format", "--in-place", path]
        return ["swift", "format", "format", "--in-place", path]
    if path.endswith(".rs"):
        return ["rustfmt", "--edition", "2024", "--config", "skip_children=true", path]
    if path.endswith(".py"):
        return ["ruff", "format", path]
    if path.endswith(".tf") or path.endswith(".tftest.hcl"):
        return ["tofu", "fmt", path]
    return None


def verify(path: str, command: list[str]) -> list[str] | None:
    if path.endswith(".swift"):
        return [*command[:2], "lint", "--strict", path]
    if path.endswith(".py"):
        return ["ruff", "format", "--check", path]
    if path.endswith(".tf") or path.endswith(".tftest.hcl"):
        return ["tofu", "fmt", "-check", path]
    return None


def main() -> int:
    staged = paths(git("diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"))
    selected = [(path, command) for path in staged if (command := formatter(path))]
    if not selected:
        subprocess.run(["git", "diff", "--cached", "--check"], check=True)
        return 0
    unstaged = set(paths(git("diff", "--name-only", "-z")))
    partial = [path for path, _ in selected if path in unstaged]
    if partial:
        print("Cannot auto-format partially staged files; stage them fully or format manually:", file=sys.stderr)
        for path in partial:
            print(f"  {path}", file=sys.stderr)
        return 1
    for path, command in selected:
        if Path(path).is_symlink():
            print(f"Refusing to format symlink: {path}", file=sys.stderr)
            return 1
        if not Path(path).is_file():
            continue
        if not shutil.which(command[0]):
            print(f"Missing {command[0]} for {path}", file=sys.stderr)
            return 1
        result = subprocess.run(command, check=False)
        if result.returncode:
            print(f"Formatter failed for {path}: {command[0]}", file=sys.stderr)
            return result.returncode
        check = verify(path, command)
        if check:
            result = subprocess.run(check, check=False)
            if result.returncode:
                print(f"Formatting check failed for {path}: {check[0]}", file=sys.stderr)
                return result.returncode
        subprocess.run(["git", "add", "--", path], check=True)
    subprocess.run(["git", "diff", "--cached", "--check"], check=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
