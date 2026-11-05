import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("toolchain", Path(__file__).with_name("apple-toolchain.py"))
toolchain = importlib.util.module_from_spec(spec)
spec.loader.exec_module(toolchain)


class ToolchainTests(unittest.TestCase):
    def test_newer_major_never_masks_compatibility(self):
        versions = {"old": "Xcode 27.0", "current": "Xcode 27.1", "new": "Xcode 28.0"}
        self.assertEqual(toolchain.select(versions, versions.get), "current")

    def test_missing_required_major_fails_before_building(self):
        with self.assertRaisesRegex(ValueError, "Xcode 27.1"):
            toolchain.select(["new"], lambda _: "Xcode 27.0")

    def test_release_candidate_is_not_selected_for_testflight(self):
        versions = {"Xcode_27.1.app": "Xcode 27.1", "Xcode_27.2_Release_Candidate.app": "Xcode 27.2"}
        self.assertEqual(toolchain.select(versions, versions.get), "Xcode_27.1.app")

    def test_runner_image_rollout_cannot_change_selected_release(self):
        versions = {"stable": "Xcode 27.1", "new": "Xcode 27.2\nBuild version abc"}
        self.assertEqual(toolchain.select(versions, versions.get), "stable")

    def test_unpinned_patch_is_not_a_fallback(self):
        with self.assertRaisesRegex(ValueError, "Xcode 27.1 is required"):
            toolchain.select(["patched"], lambda _: "Xcode 27.1.1")

    def test_trailing_zero_version_is_equivalent(self):
        self.assertEqual(toolchain.select(["stable"], lambda _: "Xcode 27.1.0"), "stable")


if __name__ == "__main__": unittest.main()
