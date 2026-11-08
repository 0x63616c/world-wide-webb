"""Render product-scoped notes from Callkeep's source release tags."""

import html
import re
import subprocess

# Historical Callkeep parents retain their original paths after subtree import.
INPUTS = [
    "apps/callkeep",
    "Sources/Callkeep",
    "Sources/CallkeepCore",
    "Packages/LocalTranscription",
    "Resources",
    "Tests",
    "Scripts",
    "project.yml",
]


def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()


def release_notes(version, revision="HEAD"):
    match = re.fullmatch(r"1\.0\.(\d+)", version)
    if not match:
        raise ValueError("Expected a Callkeep release counter (1.0.N)")
    counter = int(match[1])
    previous = []
    for tag in git("tag", "--list", "callkeep/v1.0.*").splitlines():
        found = re.fullmatch(r"callkeep/v1\.0\.(\d+)", tag)
        if not found or int(found[1]) >= counter:
            continue
        result = subprocess.run(["git", "merge-base", "--is-ancestor", tag, revision], check=False)
        if result.returncode == 1:
            continue
        result.check_returncode()
        previous.append((int(found[1]), tag))
    start = max(previous)[1] if previous else None
    range_ref = f"{start}..{revision}" if start else revision
    changes = git("log", "--no-merges", "--reverse", "--format=%s", range_ref, "--", *INPUTS).splitlines()
    items = "\n".join(f"- {html.escape(subject)}" for subject in changes) or "- Maintenance update."
    return f"## Callkeep {version}\n\n{items}\n"
