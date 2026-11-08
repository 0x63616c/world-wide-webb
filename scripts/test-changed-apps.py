#!/usr/bin/env python3
"""Run the real impact resolver against committed, isolated git fixtures."""
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
    (root / "scripts").mkdir()
    for script in ["affected", "changed-apps.sh", "app-config.rb"]:
        shutil.copy2(ROOT / "scripts" / script, root / "scripts" / script)
    (root / "packages/RDesign").mkdir(parents=True)
    (root / "packages/RDesign/code.swift").write_text("// Shared\n")
    for app in ["tendr", "samplr"]:
        path = root / "apps" / app
        path.mkdir(parents=True)
        (path / "app.yml").write_text(
            f"testflight: true\nuses: {'[RDesign]' if app == 'tendr' else '[]'}\npaths: []\n")
        (path / "code.swift").write_text(f"// {app}\n")
    git("add", ".")
    git("commit", "-qm", "Fixture")
    git("update-ref", "refs/remotes/origin/main", "HEAD")
    git("checkout", "-qb", "feature")

    def selected(base, intent):
        return json.loads(subprocess.check_output(
            ["scripts/affected", base, "--intent", intent], cwd=root, text=True))

    def expect(base, verify=(), ship=(), rdesign=False, template=False):
        for intent, apps in [("verify", verify), ("ship", ship)]:
            actual = selected(base, intent)
            expected = {"apps": list(apps), "rdesign": intent == "verify" and rdesign,
                        "template": intent == "verify" and template}
            assert actual == expected, (base, intent, actual, expected)

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
    base = change("apps/tendr/code.swift")
    for fallback in [base, "", "0" * 40, "f" * 40]:
        expect(fallback, ["tendr"], ["tendr"])
    base = change("apps/tendr/Packages/RDesign/Sources/Palette.swift")
    expect(base, ["tendr"], ["tendr"], rdesign=True)
    base = change("apps/samplr/code.swift")
    expect(base, ["samplr"], ["samplr"])
    base = change("packages/RDesign/code.swift")
    expect(base, ["tendr"], ["tendr"], True, True)
    for path in ["fastlane/Fastfile", "fastlane/Appfile", "Gemfile", "Gemfile.lock",
                 ".github/workflows/ci.yml", "scripts/build.sh"]:
        expect(change(path), ["samplr", "tendr"], rdesign=True, template=True)
    for path in ["README.md", "AGENTS.md", "docs/guide.md", "scripts/README.md",
                 "apps/tendr/docs/guide.md", "apps/samplr/README.md", "apps/samplr/notes.md",
                 "apps/samplr/fastlane/metadata/en-US/description.txt",
                 "apps/samplr/screenshots.json", "apps/samplr/docs/guide.txt"]:
        expect(change(path))
    expect(change("site/tendr/privacy/index.html"))
    expect(change("templates/new-app/Example.swift"), template=True)
    expect(change("apps/design-fixture/design.png"))
    # A move must affect both sides even if Git would identify it as a rename.
    base = git("rev-parse", "HEAD")
    git("mv", "apps/tendr/code.swift", "apps/samplr/moved.swift")
    git("commit", "-qm", "Cross-app move")
    expect(base, ["samplr", "tendr"], ["samplr", "tendr"])
    # Extra globs and TestFlight eligibility are app-local declarations.
    change("apps/samplr/app.yml", "testflight: false\nuses: []\npaths: ['shared/samplr/**']\n")
    expect(change("shared/samplr/nested/code.swift"), ["samplr"])
    expect(change("apps/samplr/app.yml", "testflight: false\nuses: []\npaths: []\n"), ["samplr"])
    expect(change("apps/samplr/app.yml", "testflight: true\nuses: []\npaths: []\n"), ["samplr"], ["samplr"])
    expect(change("apps/samplr/app.yml", "testflight: true\nuses: []\npaths: ['extra/**']\n"), ["samplr"])
    # Unknown packages must fail rather than silently lose dependency coverage.
    change("apps/samplr/app.yml", "uses: [Missing]\n")
    result = subprocess.run(["scripts/affected", "HEAD", "--intent", "verify"],
                            cwd=root, text=True, capture_output=True)
    assert result.returncode != 0 and "unknown package" in result.stderr
    change("apps/samplr/app.yml", "uses: []\n")
    # Main without a remote base compares its previous commit; branches fail clearly.
    git("checkout", "-q", "main")
    git("update-ref", "-d", "refs/remotes/origin/main")
    change("apps/samplr/code.swift")
    expect("", ["samplr"], ["samplr"])
    git("checkout", "-qb", "no-base")
    result = subprocess.run(["scripts/affected", "", "--intent", "ship"],
                            cwd=root, text=True, capture_output=True)
    assert result.returncode != 0 and "fetch main history" in result.stderr
    # Removing another app leaves a valid single-app result for workflow matrices.
    base = git("rev-parse", "HEAD")
    git("rm", "-qr", "apps/samplr")
    git("commit", "-qm", "Remove synthetic app")
    expect(base)
    expect(change("scripts/build.sh"), ["tendr"], rdesign=True, template=True)
print("Impact fixtures passed (both intents, dependencies, tooling, docs, metadata, globs, renames and base fallbacks).")
