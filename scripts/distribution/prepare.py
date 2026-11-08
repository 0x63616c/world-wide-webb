#!/usr/bin/env python3
"""Prepare an immutable orphan Git artifact; publication is a separate gated step."""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEAM = "X9E4HG27NK"


def run(*args, cwd=None, env=None):
    return subprocess.check_output(args, cwd=cwd, env=env, stderr=subprocess.PIPE, text=True).strip()


def fingerprint(root):
    result = {}
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        if ".git" in path.relative_to(root).parts:
            raise ValueError("An artifact cannot contain a Git checkout")
        if path.is_symlink():
            target = os.readlink(path)
            resolved = path.resolve()
            if Path(target).is_absolute() or root.resolve() not in resolved.parents or not resolved.exists():
                raise ValueError(f"Artifact symlink escapes or is broken: {relative}")
            result[relative] = {"symlink": target}
        elif path.is_file():
            if path.stat().st_size >= 100_000_000:
                raise ValueError(f"Artifact exceeds GitHub's per-file limit: {relative}")
            result[relative] = {
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "executable": bool(path.stat().st_mode & 0o111),
            }
        elif not path.is_dir():
            raise ValueError(f"Unsupported artifact entry: {relative}")
    return result


def validate_payload(payload, product):
    expected = {"Callkeep.app"} if product == "callkeep" else {"bin", "share"}
    names = {path.name for path in payload.iterdir()}
    if not names or not names <= expected:
        raise ValueError("Artifact root must contain only its prebuilt product payload")
    if product == "callkeep":
        app = payload / "Callkeep.app"
        run("codesign", "--verify", "--deep", "--strict", str(app))
        details = subprocess.run(
            ["codesign", "-dv", "--verbose=4", str(app)], capture_output=True, text=True, check=True
        ).stderr
        if f"TeamIdentifier={TEAM}" not in details or "Authority=Developer ID Application:" not in details:
            raise ValueError("Private Callkeep distribution requires the expected Developer ID signature")
        run("xcrun", "stapler", "validate", str(app))
    else:
        for name in ("homelab", "homelab-host", "hl"):
            binary = payload / "bin" / name
            if not binary.exists() or not os.access(binary, os.X_OK):
                raise ValueError(f"Missing executable CLI entry: {name}")


def assemble(payload, output, *, source, timestamp, product, version):
    """Preserve bytes, Git-supported modes and symlinks in a zero-parent commit."""
    before = fingerprint(payload)
    if not before:
        raise ValueError("Cannot distribute an empty artifact")
    output.mkdir(parents=True, exist_ok=False)
    repo = output / "repo"
    shutil.copytree(payload, repo, symlinks=True)
    if fingerprint(repo) != before or fingerprint(payload) != before:
        raise ValueError("Payload changed while assembling the artifact")
    receipt = {
        "version": 1,
        "product": product,
        "product_version": version,
        "source_repository": "0x63616c/world-wide-webb",
        "source_sha": source,
        "payload": before,
    }
    (repo / "artifact-receipt.json").write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    run("git", "init", "-q", str(repo))
    run("git", "config", "core.filemode", "true", cwd=repo)
    run("git", "config", "core.symlinks", "true", cwd=repo)
    run("git", "add", "--force", "--all", cwd=repo)
    tree = run("git", "write-tree", cwd=repo)
    env = dict(os.environ)
    for role in ("AUTHOR", "COMMITTER"):
        env[f"GIT_{role}_NAME"] = "World Wide Webb distribution"
        env[f"GIT_{role}_EMAIL"] = "6991398+0x63616c@users.noreply.github.com"
        env[f"GIT_{role}_DATE"] = f"{timestamp} +0000"
    commit = run(
        "git",
        "-c",
        "commit.gpgsign=false",
        "commit-tree",
        tree,
        "-m",
        f"chore(distribution): {product} {version} from {source}",
        cwd=repo,
        env=env,
    )
    run("git", "update-ref", "refs/heads/artifact", commit, cwd=repo)
    # A real Git export catches mode/symlink losses before any remote is touched.
    exported = output / "export"
    run("git", "clone", "-q", "--no-local", "--branch", "artifact", str(repo), str(exported))
    (exported / "artifact-receipt.json").unlink()
    # Exclude only the clone's own metadata, then compare every shipped entry.
    shutil.rmtree(exported / ".git")
    if fingerprint(exported) != before:
        raise ValueError("Git transport did not preserve the artifact")
    result = {
        "repository": str(repo),
        "commit": commit,
        "tag": f"dist/{product}/v{version}",
        "source_sha": source,
        "receipt_sha256": hashlib.sha256((repo / "artifact-receipt.json").read_bytes()).hexdigest(),
    }
    (output / "prepared.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("product", choices=["callkeep", "homelab"])
    parser.add_argument("version")
    parser.add_argument("payload", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"\d+\.\d+\.\d+", args.version):
        parser.error("version must use major.minor.patch")
    source = run("git", "rev-parse", "HEAD", cwd=ROOT)
    if run("git", "status", "--porcelain", cwd=ROOT):
        parser.error("commit the verified source before preparing distribution")
    timestamp = run("git", "show", "-s", "--format=%ct", source, cwd=ROOT)
    validate_payload(args.payload, args.product)
    result = assemble(
        args.payload,
        args.output,
        source=source,
        timestamp=timestamp,
        product=args.product,
        version=args.version,
    )
    validate_payload(args.output / "export", args.product)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
