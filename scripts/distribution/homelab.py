#!/usr/bin/env python3
"""Promote the exact prebuilt CLI from trusted main CI; never rebuild it here."""

import argparse
import hashlib
import json
import os
import re
import shutil
import tarfile
import tomllib
from pathlib import Path

import prepare
import publish


def checked_source():
    source = prepare.run("git", "rev-parse", "HEAD", cwd=prepare.ROOT)
    if prepare.run("git", "status", "--porcelain", cwd=prepare.ROOT):
        raise ValueError("Commit the verified source before CLI publication")
    run_id, attempt = os.environ["SOURCE_RUN_ID"], os.environ["SOURCE_RUN_ATTEMPT"]
    if not re.fullmatch(r"[1-9]\d*", run_id) or not re.fullmatch(r"[1-9]\d*", attempt):
        raise ValueError("Expected an exact source CI attempt")
    prefix = f"repos/{publish.REPOSITORY}/actions/runs/{run_id}/attempts/{attempt}"
    run = json.loads(prepare.run("gh", "api", prefix))
    if not (
        run.get("head_sha") == source
        and run.get("path") == ".github/workflows/ci.yml"
        and run.get("event") == "push"
        and run.get("head_branch") == "main"
        and run.get("head_repository", {}).get("full_name") == publish.REPOSITORY
        and run.get("status") == "completed"
        and run.get("conclusion") == "success"
        and run.get("run_attempt") == int(attempt)
    ):
        raise ValueError("CLI delivery requires successful exact-source main CI")
    pages = json.loads(prepare.run("gh", "api", "--paginate", "--slurp", prefix + "/jobs?per_page=100"))
    jobs = [job for page in pages for job in page["jobs"] if job["name"] == "Homelab / Homelab CLI"]
    if len(jobs) != 1 or any(
        jobs[0].get(key) != value
        for key, value in {"head_sha": source, "status": "completed", "conclusion": "success"}.items()
    ):
        raise ValueError("The exact portable CLI build was not verified")
    return source


def unpack(archive, checksums, target):
    rows = checksums.read_text().splitlines()
    if len(rows) != 1 or not re.fullmatch(r"[a-f0-9]{64}  build/homelab-prebuilt\.tar\.gz", rows[0]):
        raise ValueError("Unexpected CLI checksum manifest")
    if hashlib.sha256(archive.read_bytes()).hexdigest() != rows[0].split()[0]:
        raise ValueError("CLI archive differs from the tested artifact")
    target.mkdir(parents=True, exist_ok=False)
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        names = [member.name.rstrip("/") for member in members]
        if len(names) != len(set(names)) or sum(member.size for member in members) > 512 * 1024**2:
            raise ValueError("Duplicate or oversized CLI archive")
        for member in members:
            path = Path(member.name)
            if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] not in {"bin", "share"}:
                raise ValueError("CLI archive escapes its product payload")
            if not (member.isfile() or member.isdir() or member.issym()):
                raise ValueError("CLI archive contains an unsupported file")
            if member.issym() and (member.name != "bin/hl" or member.linkname != "homelab"):
                raise ValueError("CLI archive contains an unexpected symlink")
        bundle.extractall(target, filter="data")
    prepare.validate_payload(target, "homelab")
    prepare.fingerprint(target)


def formula(version, checksum):
    if not re.fullmatch(r"\d+\.\d+\.\d+", version) or not re.fullmatch(r"[a-f0-9]{64}", checksum):
        raise ValueError("Expected a CLI version and archive SHA-256")
    return rf'''class Homelab < Formula
  desc "Guided Mac setup from your Git configuration"
  homepage "https://github.com/{publish.REPOSITORY}/tree/main/homelab/cli"
  url "https://github.com/{publish.REPOSITORY}/releases/download/homelab%2Fv{version}/homelab-{version}.tar.gz"
  sha256 "{checksum}"
  version "{version}"
  license "MIT"

  livecheck do
    url "https://github.com/{publish.REPOSITORY}/releases"
    regex(%r{{/releases/tag/homelab(?:%2F|/)v?(\d+(?:\.\d+)+)}}i)
    strategy :page_match
  end

  depends_on "age"
  depends_on arch: :arm64
  depends_on "gh"
  depends_on :macos
  depends_on "sops"
  deny_network_access!

  def install
    bin.install "bin/homelab", "bin/homelab-host"
    bin.install_symlink "homelab" => "hl"
    pkgshare.install Dir["share/homelab/*"]
  end

  test do
    assert_match "homelab #{{version}}", shell_output("#{{bin}}/homelab --version")
    assert_match "homelab #{{version}}", shell_output("#{{bin}}/hl --version")
    assert_match "homelab-host #{{version}}", shell_output("#{{bin}}/homelab-host --version")
  end
end
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--verify-download", action="store_true")
    parser.add_argument("--tap", type=Path)
    args = parser.parse_args()
    source = checked_source()
    if args.verify_download:
        record = json.loads((args.output / "release.json").read_text())
        if record["source_sha"] != source:
            raise ValueError("CLI release belongs to a different source")
        downloaded = args.output / "downloaded.tar.gz"
        prepare.run(
            "curl", "--fail", "--silent", "--show-error", "--location", record["url"], "--output", str(downloaded)
        )
        if hashlib.sha256(downloaded.read_bytes()).hexdigest() != record["sha256"]:
            raise ValueError("Public CLI archive differs from the tested build")
        stage = args.output / "stage"
        if stage.exists():
            shutil.rmtree(stage)
        unpack(downloaded, args.artifact / "SHA256SUMS", stage)
        if args.tap:
            path = args.tap / "Formula/homelab.rb"
            current = path.read_text()
            versions = re.findall(r'^\s*version "(\d+\.\d+\.\d+)"', current, re.MULTILINE)
            if not versions:
                versions = re.findall(r"/v(\d+\.\d+\.\d+)/", current)
            if len(set(versions)) != 1:
                raise ValueError("Cannot establish the existing tap version")
            old, new = (tuple(map(int, version.split("."))) for version in (versions[0], record["version"]))
            rendered = formula(record["version"], record["sha256"])
            if old > new:
                raise ValueError("Refuse an older or conflicting CLI installation recipe")
            path.write_text(rendered)
        print("Verified public CLI archive checksum and payload.")
        return
    version = tomllib.loads((prepare.ROOT / "homelab/cli/Cargo.toml").read_text())["package"]["version"]
    payload = args.output / "payload"
    unpack(args.artifact / "homelab-prebuilt.tar.gz", args.artifact / "SHA256SUMS", payload)
    for binary in ("homelab", "homelab-host", "hl"):
        expected = "homelab-host" if binary == "homelab-host" else "homelab"
        if prepare.run(str(payload / "bin" / binary), "--version") != f"{expected} {version}":
            raise ValueError("The prebuilt CLI and helper versions do not agree")
    tag = f"homelab/v{version}"
    existing = publish.remote_commit(publish.REMOTE, tag)
    if existing and existing != source:
        raise ValueError("CLI version already belongs to another source; bump Cargo.toml before releasing")
    archive = args.output / f"homelab-{version}.tar.gz"
    shutil.copyfile(args.artifact / "homelab-prebuilt.tar.gz", archive)
    checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
    info = prepare.run("gh", "api", "--paginate", "--slurp", f"repos/{publish.REPOSITORY}/releases?per_page=100")
    matches = [release for page in json.loads(info) for release in page if release["tag_name"] == tag]
    if not matches:
        prepare.run(
            "gh",
            "release",
            "create",
            tag,
            "--repo",
            publish.REPOSITORY,
            "--target",
            source,
            "--draft",
            "--title",
            f"Homelab CLI {version}",
            "--notes",
            "Install: `brew install 0x63616c/tap/homelab`.",
        )
        assets = []
    else:
        assets = matches[0]["assets"]
    asset = next((asset for asset in assets if asset["name"] == archive.name), None)
    if asset:
        if asset.get("digest") != "sha256:" + checksum:
            raise ValueError("Existing CLI release asset differs; never overwrite a released version")
    else:
        prepare.run("gh", "release", "upload", tag, str(archive), "--repo", publish.REPOSITORY)
    prepare.run("gh", "release", "edit", tag, "--repo", publish.REPOSITORY, "--draft=false", "--latest=false")
    record = {
        "source_sha": source,
        "version": version,
        "tag": tag,
        "sha256": checksum,
        "url": f"https://github.com/{publish.REPOSITORY}/releases/download/homelab%2Fv{version}/{archive.name}",
    }
    (args.output / "release.json").write_text(json.dumps(record, indent=2) + "\n")
    (args.output / "homelab.rb").write_text(formula(version, checksum))
    print(f"Published CLI {version} from the exact tested build.")


if __name__ == "__main__":
    main()
