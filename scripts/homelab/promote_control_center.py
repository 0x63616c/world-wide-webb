#!/usr/bin/env python3
"""Propose one tested app image pin; required checks and homelab own deployment.

The caller must first validate successful trusted-main CI and its immutable image
artifact. A repository-scoped SSH deploy key makes this push trigger normal CI;
GitHub's workflow token intentionally does not trigger another push workflow.
"""

import argparse
import importlib.util
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = "projects/homelab/services/control-center/release.json"
REMOTE = "git@github.com:0x63616c/world-wide-webb.git"
SPEC = importlib.util.spec_from_file_location("app_release", ROOT / "projects/homelab/scripts/promote-control-center.py")
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class PromotionError(RuntimeError):
    pass


def git(root, *args, data=None, env=None):
    result = subprocess.run(
        ["git", *args],
        cwd=root,
        input=data,
        text=True,
        capture_output=True,
        env=env,
    )
    if result.returncode:
        raise PromotionError("Git operation was not confirmed; retry the same source")
    return result.stdout.strip()


def ancestor(root, old, new):
    result = subprocess.run(["git", "merge-base", "--is-ancestor", old, new], cwd=root, capture_output=True)
    if result.returncode not in (0, 1):
        raise PromotionError("Source ancestry could not be confirmed")
    return result.returncode == 0


def main_source(root, remote):
    git(root, "fetch", "--quiet", "--no-tags", remote, "refs/heads/main")
    return git(root, "rev-parse", "FETCH_HEAD")


def promote(root, source, image, ci_run_url, remote=REMOTE, branch="main"):
    if not re.fullmatch(
        r"https://github\.com/0x63616c/world-wide-webb/actions/runs/[1-9]\d*/attempts/[1-9]\d*", ci_run_url
    ):
        raise PromotionError("Expected exact CI run and attempt provenance")
    # Reuse the exact schema/identity validator used by the installed reconciler.
    candidate = release.validate(
        {
            "schemaVersion": 2,
            "sourceRepository": "0x63616c/world-wide-webb",
            "sourceRevision": source,
            "image": image,
            "databaseEngine": "sqlite",
        }
    )
    if not re.fullmatch(r"(?:main|codex/control-center-image-[a-f0-9]{40})", branch):
        raise PromotionError("Unexpected promotion branch")
    for _ in range(5):
        before = main_source(root, remote)
        if not ancestor(root, source, before):
            raise PromotionError("Image source is outside authoring main")
        current = release.validate(json.loads(git(root, "show", before + ":" + MANIFEST)))
        if current == candidate:
            return {"status": "already-pinned", "commit": before}
        if current["sourceRevision"] == source:
            raise PromotionError("An immutable source cannot acquire a different image")
        if not ancestor(root, current["sourceRevision"], source):
            raise PromotionError("An older or divergent image cannot replace the current pin")
        if branch != "main":
            existing = git(root, "ls-remote", remote, "refs/heads/" + branch)
            if existing:
                git(root, "fetch", "--quiet", "--no-tags", remote, "refs/heads/" + branch)
                existing_sha = git(root, "rev-parse", "FETCH_HEAD")
                existing_pin = release.validate(json.loads(git(root, "show", existing_sha + ":" + MANIFEST)))
                if existing_pin != candidate:
                    raise PromotionError("Promotion branch has a different immutable image")
                return {"status": "pin-proposed", "commit": existing_sha, "branch": branch}
        blob = git(root, "hash-object", "-w", "--stdin", data=json.dumps(candidate, indent=2) + "\n")
        with tempfile.TemporaryDirectory(prefix="control-center-promotion-") as scratch:
            env = dict(os.environ, GIT_INDEX_FILE=str(Path(scratch) / "index"))
            git(root, "read-tree", before, env=env)
            git(root, "update-index", "--cacheinfo", "100644", blob, MANIFEST, env=env)
            tree = git(root, "write-tree", env=env)
        identity = dict(
            os.environ,
            GIT_AUTHOR_NAME="Control Center automation",
            GIT_AUTHOR_EMAIL="actions@users.noreply.github.com",
            GIT_COMMITTER_NAME="Control Center automation",
            GIT_COMMITTER_EMAIL="actions@users.noreply.github.com",
        )
        commit = git(
            root,
            "commit-tree",
            tree,
            "-p",
            before,
            data=f"chore(control-center): promote tested image {source[:12]}\n\nVerified-CI: {ci_run_url}\n",
            env=identity,
        )
        result = subprocess.run(
            ["git", "push", remote, commit + ":refs/heads/" + branch],
            cwd=root,
            capture_output=True,
        )
        if branch != "main":
            published = git(root, "ls-remote", remote, "refs/heads/" + branch)
            if published and published.split()[0] == commit:
                return {"status": "pin-proposed", "commit": commit, "branch": branch}
            raise PromotionError("Image proposal publication was not confirmed")
        after = main_source(root, remote)
        # Read back even on a lost push response. A later commit may already
        # contain this promotion; never rewind it merely to get an exact ref.
        if ancestor(root, commit, after):
            return {"status": "pin-committed", "commit": commit}
        if result.returncode == 0 or before == after:
            raise PromotionError("Image pin publication was not confirmed")
        # Concurrent authoring changed main. Recompute the one-file edit on its
        # latest tree; a newer image pin is rejected at the next ancestry check.
    raise PromotionError("Main kept changing; retry the same tested image")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--ci-run-url", required=True)
    args = parser.parse_args()
    if os.environ.get("GITHUB_REPOSITORY") != "0x63616c/world-wide-webb":
        raise PromotionError("Unexpected promotion repository")
    branch = "codex/control-center-image-" + args.source
    result = promote(ROOT, args.source, args.image, args.ci_run_url, branch=branch)
    if result["status"] == "pin-proposed":
        # The existing publication PAT creates a real PR event, unlike GITHUB_TOKEN.
        # No bypass/admin merge: normal required checks control auto-merge.
        token = (
            subprocess.check_output(
                [
                    "sops",
                    "--decrypt",
                    "--extract",
                    '["GITHUB_PERSONAL_ACCESS_TOKEN__TOKEN"]',
                    str(ROOT / "secrets/vault.yaml"),
                ],
                stderr=subprocess.DEVNULL,
            )
            .decode()
            .strip()
        )
        if not token:
            raise PromotionError("Promotion API credential is unavailable")
        env = dict(os.environ, GH_TOKEN=token)

        def gh(*arguments):
            response = subprocess.run(["gh", *arguments], cwd=ROOT, env=env, capture_output=True, text=True)
            if response.returncode:
                raise PromotionError("Promotion PR operation failed; retry the same tested source")
            return response.stdout.strip()

        existing = json.loads(
            gh("pr", "list", "--repo", "0x63616c/world-wide-webb", "--head", branch, "--state", "open", "--json", "url")
        )
        url = (
            existing[0]["url"]
            if existing
            else gh(
                "pr",
                "create",
                "--repo",
                "0x63616c/world-wide-webb",
                "--base",
                "main",
                "--head",
                branch,
                "--title",
                "chore(control-center): promote tested image " + args.source[:12],
                "--body",
                "Promote the immutable Control Center image from successful source CI: "
                + args.ci_run_url
                + "\n\nRequired PR checks and Homelab promotion control activation; no image is rebuilt.",
            )
        )
        gh("pr", "merge", url, "--repo", "0x63616c/world-wide-webb", "--auto", "--squash")
        result["pull_request"] = url
    print(json.dumps(result))
    print("Image proposal recorded; required PR checks and Homelab promotion own activation.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, PromotionError):
        raise SystemExit("Control Center image pin was not confirmed; no deployment is claimed") from None
