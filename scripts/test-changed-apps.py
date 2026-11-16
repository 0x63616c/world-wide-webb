#!/usr/bin/env python3
"""Run the real impact resolver and selection manifest against committed, isolated git fixtures."""

import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix="affected-") as directory:
    root = Path(directory)

    def git(*args):
        return subprocess.check_output(["git", *args], cwd=root, text=True).strip()

    git("init", "-q", "-b", "main")
    git("config", "user.name", "Calum")
    git("config", "user.email", "6991398+0x63616c@users.noreply.github.com")
    git("config", "commit.gpgsign", "false")
    for script in ["scripts/affected", "scripts/ci/select_units.py", "scripts/ci/units.json"]:
        (root / script).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / script, root / script)
    for path, content in [
        ("projects/tendr/app.yml", "testflight: true\ndelivery_handler: standard_ios\n"),
        ("projects/tendr/Still/Screen.swift", "// tendr\n"),
        ("projects/folding/app.yml", "testflight: true\ndelivery_handler: folding\n"),
    ]:
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        (root / path).write_text(content)
    git("add", ".")
    git("commit", "-qm", "Fixture")
    git("update-ref", "refs/remotes/origin/main", "HEAD")
    git("checkout", "-qb", "feature")

    def selected(base, intent):
        return json.loads(subprocess.check_output(["scripts/affected", base, "--intent", intent], cwd=root, text=True))

    def expect(base, verify=(), ship=()):
        for intent, apps in [("verify", verify), ("ship", ship)]:
            actual = selected(base, intent)
            assert actual == {"apps": list(apps)}, (base, intent, actual, apps)

    counter = 0

    def change(path, content=None):
        global counter
        counter += 1
        base = git("rev-parse", "HEAD")
        dest = root / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(content if content is not None else f"// Change {counter}\n")
        git("add", ".")
        git("commit", "-qm", "Fixture change")
        return base

    expect("HEAD")
    base = change("projects/tendr/Still/Screen.swift")
    for fallback in [base, "", "0" * 40, "f" * 40]:
        expect(fallback, ["tendr"], ["tendr"])
    expect(change("projects/tendr/Still/Design/Tokens.swift"), ["tendr"], ["tendr"])
    # Tests and the screenshot framing tool are verified but never ship a binary.
    expect(change("projects/tendr/Tests/TrackingTests.swift"), ["tendr"])
    expect(change("projects/tendr/Tools/rframe/Sources/rframe/RFrame.swift"), ["tendr"])
    # Root tooling is verified by the root CI jobs, not by building the app.
    for path in [
        "fastlane/Fastfile",
        "fastlane/Appfile",
        "Gemfile",
        "Gemfile.lock",
        ".github/workflows/ci.yml",
        "scripts/build.sh",
    ]:
        expect(change(path))
    # Workflows that deliver the app also build it.
    for path in [".github/workflows/tendr-ci.yml", ".github/workflows/testflight.yml"]:
        expect(change(path), ["tendr"])
    for path in [
        "README.md",
        "AGENTS.md",
        "docs/guide.md",
        "scripts/README.md",
        "projects/tendr/docs/guide.md",
        "projects/tendr/README.md",
        "projects/tendr/fastlane/metadata/en-US/description.txt",
        "projects/tendr/screenshots.json",
        "projects/tendr/site/privacy/index.html",
    ]:
        expect(change(path))
    # A path without a declared owner verifies conservatively and ships nothing.
    expect(change("projects/design-fixture/design.png"), ["tendr"])
    # A move must affect both sides even if Git would identify it as a rename.
    base = git("rev-parse", "HEAD")
    (root / "projects/folding/apps/ios/App").mkdir(parents=True)
    git("mv", "projects/tendr/Still/Screen.swift", "projects/folding/apps/ios/App/Moved.swift")
    git("commit", "-qm", "Cross-app move")
    expect(base, ["tendr"], ["tendr"])
    # Products with a custom delivery handler never enter the standard iOS matrix.
    expect(change("projects/folding/app.yml", "testflight: false\ndelivery_handler: folding\n"))
    expect(change("projects/folding/apps/ios/App/Screen.swift"))
    # TestFlight eligibility is an app-local declaration; changing it is itself a shipping input.
    change("projects/tendr/app.yml", "testflight: false\ndelivery_handler: standard_ios\n")
    expect(change("projects/tendr/Still/Screen.swift"), ["tendr"])
    expect(change("projects/tendr/app.yml", "testflight: true\ndelivery_handler: standard_ios\n"), ["tendr"], ["tendr"])
    # Main without a remote base compares its previous commit; branches fail clearly.
    git("checkout", "-q", "main")
    git("update-ref", "-d", "refs/remotes/origin/main")
    change("projects/tendr/Still/Screen.swift")
    expect("", ["tendr"], ["tendr"])
    git("checkout", "-qb", "no-base")
    result = subprocess.run(["scripts/affected", "", "--intent", "ship"], cwd=root, text=True, capture_output=True)
    assert result.returncode != 0 and "fetch main history" in result.stderr
    expect(change("scripts/build.sh"))
    forced = json.loads(
        subprocess.check_output(["scripts/affected", "HEAD", "--intent", "verify", "--force"], cwd=root, text=True)
    )
    assert forced == {"apps": ["tendr"]}
    rejected = subprocess.run(
        ["scripts/affected", "HEAD", "--intent", "ship", "--force"], cwd=root, capture_output=True, text=True
    )
    assert rejected.returncode != 0 and "verification-only" in rejected.stderr
print("Impact fixtures passed (both intents, tooling, docs, metadata, moves, handlers and base fallbacks).")
