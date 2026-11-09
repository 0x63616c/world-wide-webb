#!/usr/bin/env python3
"""Promote the exact prebuilt CLI from trusted main CI; never rebuild it here."""

import argparse
import hashlib
import json
import os
import re
import subprocess
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
        and run.get("path") == ".github/workflows/homelab-ci.yml"
        and run.get("event") == "push"
        and run.get("head_branch") == "main"
        and run.get("head_repository", {}).get("full_name") == publish.REPOSITORY
        and run.get("status") == "completed"
        and run.get("conclusion") == "success"
        and run.get("run_attempt") == int(attempt)
    ):
        raise ValueError("CLI delivery requires successful exact-source main CI")
    pages = json.loads(prepare.run("gh", "api", "--paginate", "--slurp", prefix + "/jobs?per_page=100"))
    jobs = [job for page in pages for job in page["jobs"] if job["name"] == "Homelab CLI"]
    if len(jobs) != 1 or any(jobs[0].get(key) != value for key, value in {
        "head_sha": source, "status": "completed", "conclusion": "success"
    }.items()):
        raise ValueError("The exact portable CLI build was not verified")
    if json.loads(prepare.run("gh", "repo", "view", publish.REPOSITORY, "--json", "visibility"))["visibility"] != "PRIVATE":
        raise ValueError("CLI artifacts require the private destination")
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


def formula(version, revision):
    if not re.fullmatch(r"\d+\.\d+\.\d+", version) or not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("Expected a CLI version and immutable artifact revision")
    return f'''class Homelab < Formula
  desc "Guided Mac setup from your Git configuration"
  homepage "https://github.com/{publish.REPOSITORY}/tree/main/homelab/cli"
  url "{publish.REMOTE}", using: :git,
      tag: "dist/homelab/v{version}", revision: "{revision}"
  version "{version}"
  license "MIT"

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
        if record["source_sha"] != source or publish.remote_commit(publish.REMOTE, record["tag"]) != record["commit"]:
            raise ValueError("The retained CLI artifact identity differs")
        stage = args.output / "stage"
        receipt = stage / "artifact-receipt.json"
        if receipt.is_symlink() or not receipt.is_file() or not {"bin", "share", "artifact-receipt.json"} <= {p.name for p in stage.iterdir()} <= {"bin", "share", "artifact-receipt.json", ".git"}:
            raise ValueError("Unexpected Homebrew CLI staging entries")
        if hashlib.sha256(receipt.read_bytes()).hexdigest() != record["receipt_sha256"]:
            raise ValueError("Downloaded CLI receipt differs")
        expected = json.loads(receipt.read_text())
        actual = {}
        for name in ("bin", "share"):
            directory = stage / name
            if directory.is_symlink() or not directory.is_dir():
                raise ValueError("CLI payload directories must be regular directories")
            actual.update({name + "/" + entry: value for entry, value in prepare.fingerprint(directory).items()})
        if actual != expected["payload"]:
            raise ValueError("Downloaded CLI bytes or modes differ")
        environment = dict(os.environ)
        for name in ("GH_TOKEN", "GITHUB_TOKEN", "HOMEBREW_GITHUB_API_TOKEN", "GIT_ASKPASS", "GIT_CONFIG_PARAMETERS"):
            environment.pop(name, None)
        environment.update(GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_COUNT="0", GIT_TERMINAL_PROMPT="0")
        anonymous = subprocess.run(["git", "-c", "credential.helper=", "-c", "http.extraHeader=", "ls-remote",
                                    "--refs", publish.REMOTE, "refs/tags/" + record["tag"]],
                                   env=environment, capture_output=True, text=True, check=False)
        if anonymous.returncode == 0 or not any(message in anonymous.stderr.lower() for message in
                ("repository not found", "authentication failed", "terminal prompts disabled")):
            raise ValueError("Anonymous denial of the CLI artifact is not confirmed")
        if args.tap:
            path = args.tap / "Formula/homelab.rb"
            current = path.read_text()
            versions = re.findall(r'^\s*version "(\d+\.\d+\.\d+)"', current, re.MULTILINE)
            if not versions:
                versions = re.findall(r'/v(\d+\.\d+\.\d+)/', current)
            if len(set(versions)) != 1:
                raise ValueError("Cannot establish the existing tap version")
            old, new = (tuple(map(int, version.split("."))) for version in (versions[0], record["version"]))
            rendered = formula(record["version"], record["commit"])
            if old > new or (old == new and current != rendered):
                raise ValueError("Refuse an older or conflicting CLI installation recipe")
            path.write_text(rendered)
        print("Verified exact authenticated CLI transport and anonymous denial.")
        return
    version = tomllib.loads((prepare.ROOT / "homelab/cli/Cargo.toml").read_text())["package"]["version"]
    payload = args.output / "payload"
    unpack(args.artifact / "homelab-prebuilt.tar.gz", args.artifact / "SHA256SUMS", payload)
    for binary in ("homelab", "homelab-host", "hl"):
        expected = "homelab-host" if binary == "homelab-host" else "homelab"
        if prepare.run(str(payload / "bin" / binary), "--version") != f"{expected} {version}":
            raise ValueError("The prebuilt CLI and helper versions do not agree")
    timestamp = prepare.run("git", "show", "-s", "--format=%ct", source, cwd=prepare.ROOT)
    prepared = prepare.assemble(payload, args.output / "prepared", source=source, timestamp=timestamp,
                                product="homelab", version=version)
    publish.publish(prepared)
    record = dict(prepared, version=version)
    (args.output / "release.json").write_text(json.dumps(record, indent=2) + "\n")
    (args.output / "homelab.rb").write_text(formula(version, prepared["commit"]))
    print(f"Published immutable CLI {version}; authenticated staging must pass before the tap changes.")


if __name__ == "__main__":
    main()
