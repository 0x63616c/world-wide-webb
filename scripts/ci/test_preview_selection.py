"""Exercise the preview resolver with real committed native and shared changes."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class PreviewSelectionTests(unittest.TestCase):
    def test_shared_policy_verifies_apps_without_rendering_them(self):
        with tempfile.TemporaryDirectory(prefix="preview-selection-") as directory:
            repo = Path(directory)

            def git(*args):
                return subprocess.check_output(["git", *args], cwd=repo, text=True).strip()

            git("init", "-q", "-b", "main")
            git("config", "user.name", "Preview fixture")
            git("config", "user.email", "fixture@example.invalid")
            git("config", "commit.gpgsign", "false")
            for name in ("scripts/affected", "scripts/ci/select_units.py", "scripts/ci/units.json"):
                target = repo / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / name, target)
            app = repo / "apps/tendr"
            app.mkdir(parents=True)
            (app / "app.yml").write_text("testflight: true\npr_screenshot_test: true\nuses: []\npaths: []\n")
            git("add", ".")
            git("commit", "-qm", "Base fixture")

            def change(name, text):
                base = git("rev-parse", "HEAD")
                path = repo / name
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open("a") as file:
                    file.write(text)
                git("add", ".")
                git("commit", "-qm", "Changed input")
                return base

            def affected(base, intent):
                result = subprocess.check_output(
                    [sys.executable, "scripts/affected", base, "--intent", intent, "--only", "pr_screenshot_test"],
                    cwd=repo,
                    env=dict(os.environ),
                    text=True,
                )
                return json.loads(result)["apps"]

            shared = change("scripts/ci/select_units.py", "\n# Shared policy change\n")
            self.assertEqual(affected(shared, "verify"), ["tendr"])
            self.assertEqual(affected(shared, "preview"), [])
            native = change("apps/tendr/Still/Clock.swift", "// Changed UI\n")
            self.assertEqual(affected(native, "preview"), ["tendr"])
            helper = change("scripts/screenshot-build-settings.py", "# Changed capture helper\n")
            self.assertEqual(affected(helper, "preview"), ["tendr"])
            (repo / "packages/Shared").mkdir(parents=True)
            change("packages/Shared/theme.swift", "// Shared package\n")
            change("apps/dynamic/app.yml", "pr_screenshot_test: true\nuses: [Shared]\npaths: ['extra/ui/**']\n")
            dynamic = change("apps/dynamic/Screen.swift", "// New app outside units.json\n")
            self.assertEqual(affected(dynamic, "preview"), ["dynamic"])
            dependency = change("packages/Shared/theme.swift", "// Changed shared theme\n")
            self.assertEqual(affected(dependency, "preview"), ["dynamic"])
            declared = change("extra/ui/theme.swift", "// Declared input\n")
            self.assertEqual(affected(declared, "preview"), ["dynamic"])
            forced = subprocess.check_output(
                [sys.executable, "scripts/affected", "HEAD", "--intent", "preview", "--force"], cwd=repo, text=True
            )
            self.assertEqual(json.loads(forced)["apps"], ["dynamic", "tendr"])


if __name__ == "__main__":
    unittest.main()
