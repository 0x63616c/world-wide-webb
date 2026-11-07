import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("toolchain", Path(__file__).with_name("apple-toolchain.py"))
toolchain = importlib.util.module_from_spec(spec)
spec.loader.exec_module(toolchain)


class ToolchainTests(unittest.TestCase):
    def test_newest_supported_xcode_is_selected(self):
        versions = {"old": "Xcode 26.3", "current": "Xcode 26.4", "new": "Xcode 27.0"}
        self.assertEqual(toolchain.select(versions, versions.get), "new")

    def test_missing_required_major_fails_before_building(self):
        with self.assertRaisesRegex(ValueError, "Xcode 26.4"):
            toolchain.select(["old"], lambda _: "Xcode 26.3")

    def test_patch_versions_sort_numerically(self):
        versions = {"a": "Xcode 26.9", "b": "Xcode 26.10\nBuild version abc"}
        self.assertEqual(toolchain.select(versions, versions.get), "b")


if __name__ == "__main__":
    unittest.main()
