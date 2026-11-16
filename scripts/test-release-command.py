"""Check how scripts/release picks a build and moves the version."""

import importlib.machinery
import importlib.util
from pathlib import Path
import unittest

path = str(Path(__file__).resolve().parent / "release")
loader = importlib.machinery.SourceFileLoader("release_command", path)
release = importlib.util.module_from_spec(importlib.util.spec_from_loader("release_command", loader))
loader.exec_module(release)

APP = 'name: Tendr\nversion: 1.1.3\ntips:\n  - version: "9.9.9"\n'


class ReleaseCommandTest(unittest.TestCase):
    def test_reads_and_moves_only_the_top_level_version(self):
        self.assertEqual(release.app_version(APP), "1.1.3")
        self.assertEqual(release.app_version('version: "1.0.2"\n'), "1.0.2")
        self.assertEqual(release.next_version("1.1.9"), "1.1.10")
        self.assertEqual(release.with_version(APP, "1.1.4"), APP.replace("version: 1.1.3", "version: 1.1.4"))
        with self.assertRaises(release.ReleaseError):
            release.app_version("version: 1.1\n")

    def pick(self, versions, receipts):
        commits = list(versions)
        return release.newest_build(commits, "1.1.3", versions.get, lambda commit: commit in receipts)

    def test_picks_the_newest_processed_build_of_this_version(self):
        versions = {"c": "1.1.3", "b": "1.1.3", "a": "1.1.3"}
        self.assertEqual(self.pick(versions, {"b", "a"}), "b")

    def test_never_reaches_back_to_an_older_version(self):
        versions = {"c": "1.1.3", "b": "1.1.2", "a": "1.1.3"}
        self.assertIsNone(self.pick(versions, {"b", "a"}))
        self.assertIsNone(self.pick({"c": "1.1.3"}, set()))


if __name__ == "__main__":
    unittest.main()
