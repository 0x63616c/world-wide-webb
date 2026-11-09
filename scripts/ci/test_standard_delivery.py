"""Exercise the active standard-iOS resolver against real committed app changes."""

import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class StandardDeliveryTests(unittest.TestCase):
    def test_tests_do_not_ship_but_runtime_changes_do(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)

            def git(*arguments):
                return subprocess.check_output(["git", *arguments], cwd=repo, text=True).strip()

            def write(name, value):
                path = repo / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(value)

            def commit():
                git("add", ".")
                git("commit", "-qm", "Fixture")
                return git("rev-parse", "HEAD")

            git("init", "-q")
            git("config", "user.name", "Delivery test")
            git("config", "user.email", "test@example.invalid")
            git("config", "commit.gpgsign", "false")
            for name in ["scripts/affected", "scripts/ci/select_units.py", "scripts/ci/units.json"]:
                target = repo / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / name, target)
            write("apps/tendr/app.yml", "testflight: true\ndelivery_handler: standard_ios\nuses: []\npaths: []\n")
            write("apps/tendr/Still/Screen.swift", "screen")
            base = commit()
            for name, expected in [("apps/tendr/Tests/ImportTests.swift", []),
                                   ("apps/tendr/Packages/RDesign/Tests/PaletteTests.swift", []),
                                   ("apps/tendr/Still/Screen.swift", ["tendr"]),
                                   ("apps/tendr/Packages/RDesign/Sources/Palette.swift", ["tendr"])]:
                write(name, "changed")
                source = commit()
                result = json.loads(subprocess.check_output(
                    [str(repo / "scripts/affected"), base, "--head", source, "--intent", "ship"], cwd=repo, text=True))
                self.assertEqual(result["apps"], expected)
                base = source
            write("scripts/homelab/promote_control_center.py", "host automation")
            source = commit()
            result = json.loads(subprocess.check_output(
                [str(repo / "scripts/affected"), base, "--head", source, "--intent", "verify"], cwd=repo, text=True))
            self.assertEqual(result, {"apps": [], "tooling": False, "rdesign": False, "template": False})
            base = source
            write("scripts/check-app-backends.py", "backend template check")
            source = commit()
            result = json.loads(subprocess.check_output(
                [str(repo / "scripts/affected"), base, "--head", source, "--intent", "verify"], cwd=repo, text=True))
            self.assertEqual(result, {"apps": [], "tooling": False, "rdesign": False, "template": True})


if __name__ == "__main__":
    unittest.main()
