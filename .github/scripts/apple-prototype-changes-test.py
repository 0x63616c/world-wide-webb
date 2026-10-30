import importlib.util
from pathlib import Path
import unittest
import os
import subprocess

spec = importlib.util.spec_from_file_location("changes", Path(__file__).with_name("apple-prototype-changes.py"))
changes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(changes)


class ChangesTests(unittest.TestCase):
    def test_unrelated_and_empty_changes_skip(self):
        for paths in [[], ["README.md"], ["apps/web/src/index.ts"]]:
            self.assertEqual(changes.affected_suites(paths), [])

    def test_isolated_suites(self):
        for directory in ["Hybrid", "HybridTests", "HybridUITests", "NextAlarmWidget"]:
            self.assertEqual(changes.affected_suites([f"apps/apple-prototype/{directory}/file.swift"]), ["panel"])
        for directory in ["Tests", "UITests", "WalkActivity"]:
            self.assertEqual(changes.affected_suites([f"apps/apple-prototype/{directory}/file.swift"]), ["ipad"])

    def test_shared_and_unknown_changes_run_everything(self):
        for path in ["Sources/App.swift", "Shared/a.swift", "PanelKit/Sources/a.swift", "PanelKit/Tests/PanelKitTests/Fixtures/a.json", "project.yml", "FutureTarget/a.swift"]:
            self.assertEqual(changes.affected_suites(["apps/apple-prototype/" + path]), changes.ALL)
        for path in [".github/workflows/apple-prototype-ci.yml", ".github/scripts/apple-prototype-changes.py"]:
            self.assertEqual(changes.affected_suites([path]), changes.ALL)

    def test_git_paths_preserve_unicode_and_newlines(self):
        script = Path(__file__).with_name("apple-prototype-changes.py")
        result = subprocess.run(["python3", "-B", str(script)], input="apps/apple-prototype/Hybrid/café\nview.swift\0README.md\0", text=True, capture_output=True, check=True)
        self.assertEqual(result.stdout.strip(), 'suites=["panel"]')

    def test_union_is_stable_and_deduplicated(self):
        self.assertEqual(changes.affected_suites(["apps/apple-prototype/HybridTests/a.swift", "apps/apple-prototype/Tests/b.swift", "apps/apple-prototype/Hybrid/a.swift"]), ["ipad", "panel"])


class ResultTests(unittest.TestCase):
    def test_gate_fails_closed(self):
        script = Path(__file__).with_name("apple-prototype-result.sh")
        for planner in ["success", "failure", "cancelled", "skipped"]:
            for suites in ["success", "failure", "cancelled", "skipped"]:
                for selection in ['[]', '["ipad","panel"]']:
                    with self.subTest(planner=planner, suites=suites, selection=selection):
                        result = subprocess.run(["bash", str(script)], env={**os.environ, "CHANGES_RESULT": planner, "SUITES_RESULT": suites, "SUITES": selection})
                        expected = planner == "success" and (suites == "success" or (suites == "skipped" and selection == '[]'))
                        self.assertEqual(result.returncode == 0, expected)


if __name__ == "__main__":
    unittest.main()
