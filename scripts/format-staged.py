#!/usr/bin/env python3
"""Use one formatter policy for staged files and CI's full-source check."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(os.environ.get("FORMAT_REPO_ROOT", Path(__file__).resolve().parent.parent))
PRETTIER = ROOT / "node_modules/.bin/prettier"
SKIP_PARTS = {
    "node_modules",
    "Fixtures",
    "fixtures",
    "vendor",
    "generated",
    ".agents",
    "docs",
    "Assets.xcassets",
    "secrets",
    "migrations",
}
SKIP_PREFIXES = (
    "projects/folding/backend/crates/worker/templates/",
    "projects/folding/cloudkit/schemas/production/v1/bootstrap-receipt.json",
    "projects/callkeep/Scripts/validate-provisioning.py",
    "projects/homelab/runner/images/linux/build-image.py",
    "projects/homelab/cli/schema/homelab-v3.schema.json",
)
PRETTIER_EXTENSIONS = {".css", ".html", ".js", ".json", ".jsonc", ".mjs", ".ts", ".yaml", ".yml"}
PRETTIER_PLUGINS = {".sh": "prettier-plugin-sh", ".sql": "prettier-plugin-sql", ".toml": "prettier-plugin-toml"}


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], cwd=ROOT)


def paths(data: bytes) -> list[str]:
    return [os.fsdecode(path) for path in data.split(b"\0") if path]


def formatter(path: str, check: bool = False) -> list[str] | None:
    file = Path(path)
    if any(part in SKIP_PARTS or part.endswith(".xcassets") for part in file.parts) or path.startswith(SKIP_PREFIXES):
        return None
    suffix = file.suffix.lower()
    if file.name in {"Gemfile", "Fastfile", "Appfile", "Matchfile", "Rakefile", "Podfile"}:
        suffix = ".rb"
    elif file.name == ".swift-format":
        suffix = ".json"
    elif not suffix and (ROOT / path).is_file():
        first_line = (ROOT / path).open("rb").readline(120)
        if first_line.startswith(b"#!"):
            if b"python" in first_line:
                suffix = ".py"
            elif b"ruby" in first_line:
                suffix = ".rb"
            elif b"bash" in first_line or b"/sh" in first_line:
                suffix = ".sh"
    if suffix == ".swift":
        prefix = ["xcrun", "swift-format"] if shutil.which("xcrun") else ["swift", "format"]
        return [*prefix, "format", *([] if check else ["--in-place"]), path]
    if suffix == ".rs":
        toolchain = "1.99.0" if path.startswith("projects/homelab/") else "1.99.1"
        return [
            "rustup",
            "run",
            toolchain,
            "rustfmt",
            "--edition",
            "2024",
            "--config",
            "skip_children=true",
            *(["--check"] if check else []),
            path,
        ]
    if suffix == ".py":
        return ["ruff", "format", *(["--check"] if check else []), path]
    if suffix == ".rb":
        return ["stree", "check" if check else "write", path]
    if suffix == ".nix":
        return ["nixfmt", *(["--check"] if check else []), path]
    if suffix == ".tf" or path.endswith(".tftest.hcl"):
        return ["tofu", "fmt", *(["-check"] if check else []), path]
    if suffix in PRETTIER_EXTENSIONS or suffix in PRETTIER_PLUGINS:
        command = [str(PRETTIER)]
        if file.name == ".swift-format" or path == "projects/homelab/services/penpot/compose.yaml":
            command += ["--parser", "json"]
        if suffix == ".jsonc":
            command += ["--trailing-comma", "none"]
        if suffix in PRETTIER_PLUGINS:
            command += ["--plugin", PRETTIER_PLUGINS[suffix]]
        return [*command, "--check" if check else "--write", path]
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--all", action="store_true", help="format all maintained tracked files")
    parser.add_argument("--check", action="store_true", help="check without modifying files")
    args = parser.parse_args()
    if args.all:
        selected_paths = paths(git("ls-files", "-z"))
    else:
        selected_paths = paths(git("diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"))
    checking = args.check
    selected = [(path, formatter(path, check=checking)) for path in selected_paths]
    selected = [(path, command) for path, command in selected if command]
    if not args.all and not args.check:
        unstaged = set(paths(git("diff", "--name-only", "-z")))
        partial = [path for path, _ in selected if path in unstaged]
        if partial:
            print("Cannot auto-format partially staged files; stage them fully or format manually:", file=sys.stderr)
            for path in partial:
                print(f"  {path}", file=sys.stderr)
            return 1
    for path, command in selected:
        source = ROOT / path
        if source.is_symlink():
            print(f"Refusing to format symlink: {path}", file=sys.stderr)
            return 1
        if not source.is_file():
            continue
        if not Path(command[0]).exists() and not shutil.which(command[0]):
            print(f"Missing formatter {command[0]} for {path}", file=sys.stderr)
            return 1
        swift_check = checking and path.endswith(".swift")
        result = subprocess.run(command, cwd=ROOT, check=False, capture_output=swift_check)
        if result.returncode:
            if swift_check:
                sys.stderr.buffer.write(result.stderr)
            print(f"Formatter failed for {path}: {command[0]}", file=sys.stderr)
            return result.returncode
        if swift_check:
            if result.stdout != source.read_bytes():
                print(f"Needs formatting: {path}", file=sys.stderr)
                return 1
        if path.endswith(".swift") and path.startswith(
            ("projects/control-center/apple/", "projects/folding/apps/ios/")
        ):
            lint = [*command[:2], "lint", "--strict", path]
            result = subprocess.run(lint, cwd=ROOT, check=False)
            if result.returncode:
                return result.returncode
        if not args.all and not args.check:
            subprocess.run(["git", "add", "--", path], cwd=ROOT, check=True)
    if not args.all and not args.check:
        subprocess.run(["git", "diff", "--cached", "--check"], cwd=ROOT, check=True)
    print(f"Formatting {'checked' if checking else 'applied to'} {len(selected)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
