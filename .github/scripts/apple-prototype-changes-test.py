import importlib.util
from pathlib import Path
import unittest

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

    def test_union_is_stable_and_deduplicated(self):
        self.assertEqual(changes.affected_suites(["apps/apple-prototype/HybridTests/a.swift", "apps/apple-prototype/Tests/b.swift", "apps/apple-prototype/Hybrid/a.swift"]), ["ipad", "panel"])


if __name__ == "__main__":
    unittest.main()
