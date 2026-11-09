#!/usr/bin/env python3
"""Callkeep's single CI writer: reserve, seal, reuse and publish an app."""

import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[3]
PRODUCT = ROOT / "apps/callkeep"
sys.path.insert(0, str(ROOT / "scripts/distribution"))
import prepare  # noqa: E402

REPOSITORY = "0x63616c/world-wide-webb"
MINIMUM_COUNTER = 25  # Last legacy release: v1.0.25; WWW begins at 1.0.26.
TAG = re.compile(r"callkeep/v1\.0\.([1-9]\d*)")


def api(path, body=None):
    args = ["gh", "api", path]
    if body is not None:
        args += ["--method", "POST", "--input", "-"]
    result = subprocess.run(
        args,
        input=json.dumps(body) if body is not None else None,
        capture_output=True,
        text=True,
        cwd=ROOT,
        check=False,
    )
    if result.returncode:
        raise RuntimeError("GitHub operation was not confirmed; reconcile before retrying")
    return json.loads(result.stdout)


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w") as file:
        os.chmod(temporary, 0o600)
        json.dump(value, file, indent=2, sort_keys=True)
        file.write("\n")
    temporary.replace(path)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def trusted_source():
    source = prepare.run("git", "rev-parse", "HEAD", cwd=ROOT)
    if prepare.run("git", "status", "--porcelain", cwd=ROOT):
        raise RuntimeError("Commit the verified source before publishing Callkeep")
    url = os.environ["CALLKEEP_SOURCE_CI_RUN_URL"]
    match = re.fullmatch(r"https://github\.com/0x63616c/world-wide-webb/actions/runs/(\d+)/attempts/(\d+)", url)
    if not match:
        raise ValueError("Expected an exact source CI attempt")
    prefix = f"repos/{REPOSITORY}/actions/runs/{match[1]}/attempts/{match[2]}"
    run = api(prefix)
    if (
        run.get("head_sha") != source
        or run.get("path") != ".github/workflows/callkeep-ci.yml"
        or run.get("event") != "push"
        or run.get("head_branch") != "main"
        or run.get("head_repository", {}).get("full_name") != REPOSITORY
        or run.get("status") != "completed"
        or run.get("conclusion") != "success"
        or run.get("run_attempt") != int(match[2])
    ):
        raise ValueError("Callkeep source CI is not a successful trusted main attempt")
    pages = json.loads(prepare.run("gh", "api", "--paginate", "--slurp", prefix + "/jobs?per_page=100"))
    jobs = [job for page in pages for job in page["jobs"] if job["name"] == "Callkeep native"]
    if (
        len(jobs) != 1
        or jobs[0].get("head_sha") != source
        or jobs[0].get("status") != "completed"
        or jobs[0].get("conclusion") != "success"
    ):
        raise ValueError("Exact Callkeep native verification is missing")
    return source


class Release:
    def __init__(self, tag):
        if not TAG.fullmatch(tag) and tag != "callkeep-delivery":
            raise ValueError("Invalid product release tag")
        self.tag = tag

    def info(self):
        result = subprocess.run(
            ["gh", "release", "view", self.tag, "--repo", REPOSITORY, "--json", "assets,isDraft,tagName"],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode:
            if "release not found" in result.stderr.lower():
                return None
            raise RuntimeError("Release lookup failed; do not assume absence")
        return json.loads(result.stdout)

    def ensure(self, source):
        if self.info():
            return
        try:
            prepare.run(
                "gh",
                "release",
                "create",
                self.tag,
                "--repo",
                REPOSITORY,
                "--target",
                source,
                "--draft",
                "--title",
                self.tag,
                "--notes",
                "Callkeep release records and signed artifacts.",
            )
        except subprocess.CalledProcessError:
            if not self.info():
                raise RuntimeError("Release creation is not confirmed") from None

    def download(self, name, directory):
        if Path(name).name != name:
            raise ValueError("Invalid immutable asset name")
        path = directory / name
        if not path.exists():
            prepare.run(
                "gh", "release", "download", self.tag, "--repo", REPOSITORY, "--pattern", name, "--dir", str(directory)
            )
        return path

    def latest(self, prefix="manifest"):
        info = self.info()
        names = [] if info is None else [asset["name"] for asset in info["assets"]]
        names = [name for name in names if re.fullmatch(re.escape(prefix) + r"-r\d{8}\.json", name)]
        if not names:
            return None
        with tempfile.TemporaryDirectory() as directory:
            return json.loads(self.download(max(names), Path(directory)).read_text())

    def save(self, value, prefix="manifest"):
        previous = self.latest(prefix)
        if prefix == "manifest" and value.get("revision", 0) != (previous["revision"] if previous else 0):
            raise RuntimeError("Release changed concurrently; reload its latest immutable record")
        value = dict(value, revision=(previous["revision"] if previous else 0) + 1)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / f"{prefix}-r{value['revision']:08d}.json"
            atomic_json(path, value)
            # Exclusive asset names are the state compare-and-set; never clobber.
            prepare.run("gh", "release", "upload", self.tag, str(path), "--repo", REPOSITORY)
        return value

    def upload(self, path):
        if any(asset["name"] == path.name for asset in self.info()["assets"]):
            with tempfile.TemporaryDirectory() as directory:
                existing = self.download(path.name, Path(directory))
                if sha(existing) != sha(path):
                    raise ValueError("Immutable release asset differs")
        else:
            prepare.run("gh", "release", "upload", self.tag, str(path), "--repo", REPOSITORY)


def source_tags():
    pages = json.loads(
        prepare.run("gh", "api", "--paginate", "--slurp", f"repos/{REPOSITORY}/git/matching-refs/tags/callkeep/v1.0.")
    )
    result = []
    for page in pages:
        for ref in page:
            name = ref["ref"].removeprefix("refs/tags/")
            match = TAG.fullmatch(name)
            if match:
                if ref["object"]["type"] != "commit":
                    raise ValueError("Product source reservations must directly identify commits")
                result.append((int(match[1]), name, ref["object"]["sha"]))
    return sorted(result)


def complete_assets(release, record):
    if not record or not record.get("candidates"):
        return False
    if set(record["candidates"]) != {"archive", "dsym", "notary"}:
        raise ValueError("The complete archive, symbols and notarization receipt are required")
    for item in record["candidates"].values():
        if Path(item["name"]).name != item["name"] or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
            raise ValueError("Invalid sealed artifact descriptor")
    names = {asset["name"] for asset in release.info()["assets"]}
    return all(item["name"] in names for item in record["candidates"].values())


def reserve(source):
    pointer = Release("callkeep-delivery")
    fence = pointer.latest("promotion")
    if fence:
        comparison = subprocess.run(
            prepare.git_command("merge-base", "--is-ancestor", source, fence["source_sha"]),
            cwd=ROOT, capture_output=True, check=False,
        )
        if comparison.returncode == 0 and source != fence["source_sha"]:
            return {"needed": False, "source_sha": source}
        if comparison.returncode not in (0, 1):
            raise RuntimeError("Cannot establish the promotion-source ancestry")
    delivered = pointer.latest("delivery")
    if delivered:
        comparison = subprocess.run(
            prepare.git_command("merge-base", "--is-ancestor", source, delivered["source_sha"]),
            cwd=ROOT,
            capture_output=True,
            check=False,
        )
        if comparison.returncode == 0:
            if delivered["source_sha"] == source:
                release = Release(delivered["tag"])
                record = release.latest()
                if (
                    record
                    and record.get("archive_sha256") == delivered["archive_sha256"]
                    and record.get("state") != "complete"
                ):
                    release.save(dict(record, state="complete"))
            return {"needed": False, "source_sha": source}
        if comparison.returncode != 1:
            raise RuntimeError("Cannot establish the delivered-source ancestry")
    replacement = None
    replacement_reason = None
    for _ in range(5):
        tags = source_tags()
        matching = [entry for entry in tags if entry[2] == source]
        if matching:
            _, tag, _ = matching[-1]
            release = Release(tag)
            release.ensure(source)
            record = release.latest()
            if fence and int(tag.rsplit(".", 1)[1]) < int(fence["version"].rsplit(".", 1)[1]):
                replacement = tag
                replacement_reason = "superseded_promotion_counter"
            elif record and record.get("archive_attempt_started") and not complete_assets(release, record):
                replacement_reason = "interrupted_archive"
                replacement = tag  # Burn a possibly built number; keep every old record/artifact.
            else:
                if record is None:
                    record = release.save(
                        {
                            "schema_version": 1,
                            "source_sha": source,
                            "tag": tag,
                            "version": tag.split("/v")[1],
                            "state": "planned",
                        }
                    )
                return dict(record, needed=True, build=not complete_assets(release, record))
        counter = max([MINIMUM_COUNTER, *(entry[0] for entry in tags)]) + 1
        tag = f"callkeep/v1.0.{counter}"
        try:
            api(f"repos/{REPOSITORY}/git/refs", {"ref": "refs/tags/" + tag, "sha": source})
        except RuntimeError:
            # A collision or lost response is reconciled by immutable ref readback.
            if not any(item[1] == tag and item[2] == source for item in source_tags()):
                continue
        release = Release(tag)
        release.ensure(source)
        record = release.save(
            {
                "schema_version": 1,
                "source_sha": source,
                "tag": tag,
                "version": f"1.0.{counter}",
                "state": "planned",
                "replaces_tag": replacement,
                "replacement_reason": replacement_reason,
            }
        )
        return dict(record, needed=True, build=True)
    raise RuntimeError("Could not confirm a unique Callkeep reservation; retry the same source")


def load_state(path, source):
    state = json.loads(path.read_text())
    release = Release(state["tag"])
    record = release.latest()
    if record["source_sha"] != source or record["version"] != state["version"]:
        raise ValueError("Release identity differs from the verified source")
    return release, record


def safe_extract(archive, destination):
    import zipfile

    with zipfile.ZipFile(archive) as bundle:
        entries = bundle.infolist()
        if len(entries) > 20_000 or sum(item.file_size for item in entries) > 500_000_000:
            raise ValueError("Unexpected application archive size")
        for item in entries:
            path = PurePosixPath(item.filename)
            if (
                path.is_absolute()
                or ".." in path.parts
                or not path.parts
                or path.parts[0] not in {"Callkeep.app", "__MACOSX"}
            ):
                raise ValueError("Archive path escapes the application payload")
            if stat.S_ISLNK(item.external_attr >> 16):
                import posixpath

                target = bundle.read(item).decode()
                resolved = posixpath.normpath(posixpath.join(str(path.parent), target))
                if target.startswith("/") or not resolved.startswith("Callkeep.app/"):
                    raise ValueError("Archive symlink escapes its application")
    prepare.run("ditto", "-x", "-k", str(archive), str(destination))


def directory(record):
    path = PRODUCT / "build/releases" / record["version"]
    path.mkdir(parents=True, exist_ok=True)
    return path


def seal(release, record):
    if not record.get("archive_attempt_started"):
        raise ValueError("Record archive intent before building or signing")
    output = directory(record)
    app = PRODUCT / "build/Build/Products/Release/Callkeep.app"
    prepare.validate_callkeep_identity(app, record["source_sha"], record["version"])
    for architecture in ("arm64", "x86_64"):
        prepare.run("lipo", str(app / "Contents/MacOS/Callkeep"), "-verify_arch", architecture)
    archive = output / f"Callkeep-{record['version']}.zip"
    payload = output / "payload"
    if payload.exists():
        raise ValueError("Unreconciled local payload exists")
    payload.mkdir()
    safe_extract(archive, payload)
    prepare.validate_payload(payload, "callkeep", source=record["source_sha"], version=record["version"])
    symbols = output / "symbols"
    symbols.mkdir()
    for name in ("Callkeep.app.dSYM", "CallkeepCore.framework.dSYM"):
        shutil.copytree(PRODUCT / "build/Build/Products/Release" / name, symbols / name)
    dsym = output / f"Callkeep-{record['version']}.dSYMs.zip"
    prepare.run("ditto", "-c", "-k", "--keepParent", str(symbols), str(dsym))
    notarization = Path(str(archive) + ".notary.json")
    if json.loads(notarization.read_text())["status"] != "Accepted":
        raise ValueError("Notarization acceptance receipt missing")
    candidates = {
        name: {"name": path.name, "sha256": sha(path)}
        for name, path in (("archive", archive), ("dsym", dsym), ("notary", notarization))
    }
    record = release.save(dict(record, candidates=candidates))
    # The ZIP is last: its presence means symbols/notary evidence already survived the job.
    for path in (dsym, notarization, archive):
        release.upload(path)
    return release.save(dict(record, state="sealed"))


def promote(release, record):
    if not complete_assets(release, record):
        raise ValueError("Complete sealed artifacts are required; never rebuild this reservation")
    output = directory(record)
    for item in record["candidates"].values():
        path = release.download(item["name"], output)
        if sha(path) != item["sha256"]:
            raise ValueError("Sealed release artifact changed")
    payload = output / "promotion-payload"
    if not payload.exists():
        payload.mkdir()
        safe_extract(output / record["candidates"]["archive"]["name"], payload)
    prepare.validate_payload(payload, "callkeep", source=record["source_sha"], version=record["version"])
    record = release.save(
        dict(record, state="artifact_published", archive_sha256=record["candidates"]["archive"]["sha256"])
    )
    from release_notes import release_notes

    previous = Release("callkeep-delivery").latest("delivery")
    baseline = f"callkeep/v1.0.{MINIMUM_COUNTER}"
    baseline_exists = (
        subprocess.run(
            prepare.git_command("rev-parse", "--verify", baseline), cwd=ROOT, capture_output=True, check=False
        ).returncode
        == 0
    )
    notes = output / "release-notes.md"
    notes.write_text(
        release_notes(
            record["version"],
            record["source_sha"],
            previous_tag=previous["tag"] if previous else baseline if baseline_exists else None,
        )
        + "\nInstall: `brew install --cask 0x63616c/tap/callkeep`.\n"
    )
    prepare.run(
        "gh", "release", "edit", record["tag"], "--repo", REPOSITORY, "--draft=false", "--latest=false", "--notes-file", str(notes)
    )
    return record


def fence_promotion(record):
    """Persist monotonic intent before tap mutation, including an ambiguous push."""
    require_download_proof(record)
    pointer = Release("callkeep-delivery")
    previous = pointer.latest("promotion")
    if previous:
        comparison = subprocess.run(
            prepare.git_command("merge-base", "--is-ancestor", previous["source_sha"], record["source_sha"]),
            cwd=ROOT, capture_output=True, check=False,
        )
        if comparison.returncode != 0:
            raise ValueError("Refuse older or unrelated Callkeep promotion")
        if int(record["version"].rsplit(".", 1)[1]) < int(previous["version"].rsplit(".", 1)[1]):
            raise ValueError("Refuse a lower Callkeep release counter")
        if previous["archive_sha256"] == record["archive_sha256"]:
            return
    pointer.ensure(record["source_sha"])
    pointer.save({key: record[key] for key in ("source_sha", "version", "tag", "archive_sha256")}, "promotion")


def verify_download(release, record):
    if record["state"] != "artifact_published":
        raise ValueError("Publish the immutable artifact before its download canary")
    archive = record["candidates"]["archive"]
    url = f"https://github.com/{REPOSITORY}/releases/download/callkeep%2Fv{record['version']}/{archive['name']}"
    with tempfile.TemporaryDirectory(prefix="callkeep-public-download-") as temporary:
        folder = Path(temporary)
        downloaded = folder / archive["name"]
        prepare.run("curl", "--fail", "--silent", "--show-error", "--location", url, "--output", str(downloaded))
        if sha(downloaded) != archive["sha256"]:
            raise ValueError("Public archive checksum differs from the sealed build")
        stage = folder / "stage"
        stage.mkdir()
        safe_extract(downloaded, stage)
        prepare.validate_callkeep_app(stage / "Callkeep.app", record["source_sha"], record["version"])
    return release.save(dict(record, download_verified={
        "source_sha": record["source_sha"], "archive_sha256": record["archive_sha256"], "public_download": True,
    }))


def require_download_proof(record):
    if record["state"] not in {"artifact_published", "complete"}:
        raise ValueError("Publish the immutable payload before changing install authority")
    proof = record.get("download_verified", {})
    if (
        proof.get("source_sha") != record["source_sha"]
        or proof.get("archive_sha256") != record["archive_sha256"]
        or proof.get("public_download") is not True
    ):
        raise ValueError("The public archive download must match the sealed build first")


def complete(release, record, tap):
    require_download_proof(record)
    remote = prepare.run("git", "remote", "get-url", "origin", cwd=tap)
    if remote not in {
        "https://github.com/0x63616c/homebrew-tap.git",
        "git@github.com:0x63616c/homebrew-tap.git",
        "ssh://git@github.com/0x63616c/homebrew-tap.git",
    }:
        raise ValueError("Verify the actual Homebrew tap authority")
    prepare.run("git", "fetch", "origin", "main", cwd=tap)
    expected = directory(record) / "expected-cask.rb"
    prepare.run(
        "python3",
        str(PRODUCT / "Scripts/homebrew-cask.py"),
        record["version"],
        record["archive_sha256"],
        str(expected),
    )
    remote = prepare.run("git", "show", "origin/main:Casks/callkeep.rb", cwd=tap)
    if remote.strip() != expected.read_text().strip():
        raise ValueError("Tap main does not confirm this exact published artifact")
    receipt = {
        "schema_version": 1,
        "source_sha": record["source_sha"],
        "version": record["version"],
        "tag": record["tag"],
        "archive_sha256": record["archive_sha256"],
        "tap_commit": prepare.run("git", "rev-parse", "origin/main", cwd=tap),
    }
    pointer = Release("callkeep-delivery")
    pointer.ensure(record["source_sha"])
    previous = pointer.latest("delivery")
    if (
        not previous
        or previous["source_sha"] != record["source_sha"]
        or previous["archive_sha256"] != record["archive_sha256"]
    ):
        pointer.save(receipt, "delivery")
    return release.save(dict(record, state="complete"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command", choices=["reserve", "start", "seal", "promote", "verify-download", "cask", "complete"]
    )
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--tap", type=Path)
    args = parser.parse_args()
    source = trusted_source()
    if args.command == "reserve":
        state = reserve(source)
    else:
        release, state = load_state(args.state, source)
        if args.command == "start":
            if state.get("archive_attempt_started"):
                raise ValueError("Archive already attempted; recover through a new reservation")
            state = release.save(dict(state, archive_attempt_started=True))
        elif args.command == "seal":
            state = seal(release, state)
        elif args.command == "promote":
            state = promote(release, state)
        elif args.command == "verify-download":
            state = verify_download(release, state)
        elif args.command == "cask":
            if not args.tap:
                parser.error("--tap is required")
            fence_promotion(state)
            prepare.run(
                "python3",
                str(PRODUCT / "Scripts/homebrew-cask.py"),
                state["version"],
                state["archive_sha256"],
                str(args.tap / "Casks/callkeep.rb"),
            )
        elif args.command == "complete":
            if not args.tap:
                parser.error("--tap is required")
            state = complete(release, state, args.tap)
    atomic_json(args.state, state)
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            for key in ("needed", "build", "version", "archive_sha256"):
                if key in state:
                    output.write(f"{key}={str(state[key]).lower() if isinstance(state[key], bool) else state[key]}\n")
    print("Confirmed Callkeep release step: " + args.command)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
        print(
            f"Callkeep release stopped ({type(error).__name__}); reconcile the retained reservation before retrying",
            file=sys.stderr,
        )
        raise SystemExit(1) from None
