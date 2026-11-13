"""Run real selectors with the exact checkout paths used by their workflows."""

import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[2]
UNIT_WORKFLOWS = (
    "homelab-ci.yml",
    "folding-ci.yml",
    "site.yml",
    "callkeep-ci.yml",
    "folding-store-checks.yml",
)


class SparseSelectionTests(unittest.TestCase):
    def test_full_and_sparse_checkouts_select_the_same_cross_product_changes(self):
        with tempfile.TemporaryDirectory(prefix="sparse-selection-") as temporary:
            repo = Path(temporary) / "repository"
            repo.mkdir()

            def git(*args):
                return subprocess.check_output(["git", *args], cwd=repo, text=True, stderr=subprocess.PIPE).strip()

            git("init", "-q", "-b", "main")
            git("config", "user.name", "Selection fixture")
            git("config", "user.email", "fixture@example.test")
            for name in (
                ".github/actions/select/action.yml",
                "scripts/ci/select_units.py",
                "scripts/ci/units.json",
                "projects/control-center/tools/ci_changes.py",
            ):
                target = repo / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / name, target)
            for name in (
                "projects/folding/apps/ios/App/Fixture.swift",
                "projects/homelab/modules/fixture.nix",
                "projects/control-center/server/src/main.rs",
            ):
                target = repo / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("baseline\n")
            git("add", ".")
            git("commit", "-qm", "Fixture base")
            base = git("rev-parse", "HEAD")
            (repo / "projects/callkeep/Sources").mkdir(parents=True)
            git("mv", "projects/folding/apps/ios/App/Fixture.swift", "projects/callkeep/Sources/Moved.swift")
            git("rm", "projects/homelab/modules/fixture.nix")
            (repo / "projects/control-center/server/src/main.rs").write_text("changed\n")
            git("add", ".")
            git("commit", "-qm", "Move, delete and edit across products")
            head = git("rev-parse", "HEAD")

            def run_selector(control_center=False):
                if control_center:
                    cwd = repo / "projects/control-center"
                    subprocess.run(
                        [sys.executable, "tools/ci_changes.py", base, head],
                        cwd=cwd,
                        check=True,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                    )
                    output = cwd / "ci-selection.json"
                    value = json.loads(output.read_text())
                    output.unlink()
                    return value
                output = Path(temporary) / "selection.json"
                subprocess.run(
                    [
                        sys.executable,
                        "scripts/ci/select_units.py",
                        base,
                        head,
                        "--event",
                        "pull_request",
                        "--output",
                        str(output),
                    ],
                    cwd=repo,
                    check=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )
                return json.loads(output.read_text())

            full = run_selector()
            full_control_center = run_selector(True)
            self.assertEqual(
                set(full["delivery_candidates"]),
                {"folding.native", "callkeep.native", "homelab.config", "control-center.server"},
            )
            self.assertTrue(full_control_center["image"])
            for filename, control_center in [(name, False) for name in UNIT_WORKFLOWS] + [
                ("control-center-ci.yml", True)
            ]:
                with self.subTest(workflow=filename):
                    jobs = yaml.safe_load((ROOT / ".github/workflows" / filename).read_text())["jobs"]
                    job = jobs["changes" if control_center else "selection"]
                    checkout = next(
                        step for step in job["steps"] if step.get("uses", "").startswith("actions/checkout@")
                    )
                    options = checkout["with"]
                    self.assertEqual(options["fetch-depth"], 0)
                    self.assertNotIn("filter", options, "An explicit filter overrides checkout sparse input")
                    git("sparse-checkout", "set", *options["sparse-checkout"].splitlines())
                    self.assertFalse((repo / "projects/callkeep/Sources/Moved.swift").exists())
                    self.assertFalse((repo / "projects/control-center/server/src/main.rs").exists())
                    self.assertEqual(run_selector(control_center), full_control_center if control_center else full)
