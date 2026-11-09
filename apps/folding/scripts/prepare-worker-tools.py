#!/usr/bin/env python3
"""Prepare the exact Worker build helpers through checksum-verified release APIs."""

import argparse
import hashlib
import json
import os
import platform
import re
import subprocess
import tarfile
import tempfile
import urllib.request
from pathlib import Path

import tomllib

ROOT = Path(__file__).resolve().parents[1]


def fetch(url, accept):
    request = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": "folding-build-tools"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def platforms(system, machine):
    targets = {
        ("Linux", "aarch64"): ("aarch64-unknown-linux-musl", "aarch64-linux"),
        ("Linux", "arm64"): ("aarch64-unknown-linux-musl", "aarch64-linux"),
        ("Linux", "x86_64"): ("x86_64-unknown-linux-musl", "x86_64-linux"),
        ("Darwin", "arm64"): ("aarch64-apple-darwin", "arm64-macos"),
        ("Darwin", "x86_64"): ("x86_64-apple-darwin", "x86_64-macos"),
    }
    if (system, machine) not in targets:
        raise ValueError("Unsupported Worker build host")
    return targets[system, machine]


def checked_binary(directory, name, version):
    matches = [path for path in directory.rglob(name) if path.is_file()]
    if len(matches) != 1:
        raise ValueError("Expected exactly one Worker helper executable")
    binary = matches[0]
    output = subprocess.check_output([str(binary), "--version"], text=True, timeout=15).strip()
    expected = f"wasm-bindgen {version}" if name == "wasm-bindgen" else f"wasm-opt version {version}"
    if not re.match(re.escape(expected) + r"(?:\s|$)", output):
        raise ValueError("Worker helper version differs from the pinned build")
    return binary


def install(root, repository, tag, asset_name, binary_name, version, target, download=fetch):
    destination = root / f"{binary_name}-{version}-{target}"
    if destination.exists():
        return checked_binary(destination, binary_name, version)
    api = f"https://api.github.com/repos/{repository}/releases"
    metadata = json.loads(download(f"{api}/tags/{tag}", "application/vnd.github+json"))
    assets = [asset for asset in metadata["assets"] if asset["name"] == asset_name]
    if len(assets) != 1 or type(assets[0].get("id")) is not int or assets[0]["id"] < 1:
        raise ValueError("Expected one exact upstream Worker helper asset")
    digest = assets[0].get("digest", "")
    if not isinstance(digest, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        raise ValueError("Upstream Worker helper asset has no SHA256 identity")
    payload = download(f"{api}/assets/{assets[0]['id']}", "application/octet-stream")
    if hashlib.sha256(payload).hexdigest() != digest.removeprefix("sha256:"):
        raise ValueError("Worker helper archive checksum mismatch")
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="prepare-", dir=root) as temporary:
        stage = Path(temporary)
        archive = stage / "tool.tar.gz"
        archive.write_bytes(payload)
        extracted = stage / "extracted"
        extracted.mkdir()
        with tarfile.open(archive, "r:gz") as bundle:
            bundle.extractall(extracted, filter="data")
        binary = checked_binary(extracted, binary_name, version)
        relative = binary.relative_to(extracted)
        # Retain sidecar libraries and publish only a complete validated tool.
        os.rename(extracted, destination)
        return destination / relative


def prepare(root, bindgen_version, opt_version, system, machine, download=fetch):
    bindgen_target, opt_target = platforms(system, machine)
    return {
        "WASM_BINDGEN_BIN": install(
            root,
            "wasm-bindgen/wasm-bindgen",
            bindgen_version,
            f"wasm-bindgen-{bindgen_version}-{bindgen_target}.tar.gz",
            "wasm-bindgen",
            bindgen_version,
            bindgen_target,
            download,
        ),
        "WASM_OPT_BIN": install(
            root,
            "WebAssembly/binaryen",
            f"version_{opt_version}",
            f"binaryen-version_{opt_version}-{opt_target}.tar.gz",
            "wasm-opt",
            opt_version,
            opt_target,
            download,
        ),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument(
        "--output", type=Path, required=True, help="Append helper paths to this Actions environment file"
    )
    args = parser.parse_args()
    lock = tomllib.loads((ROOT / "backend/Cargo.lock").read_text())
    versions = {item["version"] for item in lock["package"] if item["name"] == "wasm-bindgen"}
    if len(versions) != 1:
        raise ValueError("Expected one exact wasm-bindgen dependency in Cargo.lock")
    pins = json.loads((ROOT / "backend/tool-versions.json").read_text())
    values = prepare(args.root.resolve(), versions.pop(), pins["wasm_opt"], platform.system(), platform.machine())
    with args.output.open("a", encoding="utf-8") as output:
        for name, value in values.items():
            if "\n" in str(value) or "\r" in str(value):
                raise ValueError("Invalid Worker helper path")
            output.write(f"{name}={value}\n")
    print("Prepared the exact wasm-bindgen and wasm-opt helpers")


if __name__ == "__main__":
    main()
