"""Verify build cleanup boundaries without invoking system registration tools."""

import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "packaging", Path(__file__).resolve().parents[1] / "Scripts/package_macos.py"
)
packaging = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(packaging)


class PackagingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.derived = self.root / "build/macos-release"
        self.app = self.derived / "Build/Products/Release/Golink.app"
        self.extension = self.app / "Contents/PlugIns/Golink Extension.appex"
        self.extension.mkdir(parents=True)
        self.installed = self.root / "Applications/Golink.app"
        self.installed.mkdir(parents=True)
        self.calls = []

    def run_command(self, command, **kwargs):
        self.calls.append(command)
        if command[0] == "ditto":
            Path(command[-1]).write_bytes(b"fixture archive")
        return subprocess.CompletedProcess(command, 0, "", "")

    def test_success_archives_then_unregisters_only_generated_app(self):
        packaging.package(self.derived, True, root=self.root, run=self.run_command)
        self.assertTrue(self.app.with_suffix(".zip").is_file())
        self.assertFalse(self.app.exists())
        self.assertTrue(self.installed.is_dir())
        self.assertEqual(self.calls[1], ["pluginkit", "-r", str(self.extension)])
        self.assertEqual(self.calls[2], [packaging.REGISTRAR, "-u", str(self.app)])

    def test_failed_build_preserves_partial_bundle_in_diagnostic_zip(self):
        packaging.package(self.derived, False, root=self.root, run=self.run_command)
        self.assertTrue(self.app.with_suffix(".failed-build.zip").is_file())
        self.assertFalse(self.app.exists())

    def test_failed_archive_preserves_generated_bundle_and_does_not_unregister(self):
        def fail(command, **kwargs):
            self.calls.append(command)
            raise subprocess.CalledProcessError(1, command)

        with self.assertRaisesRegex(RuntimeError, "preserving it"):
            packaging.package(self.derived, True, root=self.root, run=fail)
        self.assertTrue(self.app.is_dir())
        self.assertEqual(len(self.calls), 1)

    def test_unregistration_failure_is_reported_after_archiving_and_removing_copy(self):
        def fail_registration(command, **kwargs):
            result = self.run_command(command, **kwargs)
            return result if command[0] == "ditto" else subprocess.CompletedProcess(command, 1, "", "unavailable")

        with self.assertRaisesRegex(RuntimeError, "unregister"):
            packaging.package(self.derived, True, root=self.root, run=fail_registration)
        self.assertFalse(self.app.exists())
        self.assertTrue(self.app.with_suffix(".zip").is_file())

    def test_external_and_redirected_derived_directories_are_rejected(self):
        with self.assertRaises(ValueError):
            packaging.package(self.root / "Applications", True, root=self.root, run=self.run_command)
        (self.root / "other-product").mkdir()
        alias = self.root / "build/macos"
        alias.symlink_to(self.root / "other-product", target_is_directory=True)
        with self.assertRaises(ValueError):
            packaging.package(alias, True, root=self.root, run=self.run_command)
        self.assertEqual(self.calls, [])

    def test_redirected_app_is_rejected_without_touching_installed_copy(self):
        alias = self.derived / "Build/Products/Debug/Golink.app"
        alias.parent.mkdir()
        alias.symlink_to(self.installed, target_is_directory=True)
        with self.assertRaises(ValueError):
            packaging.package(self.derived, True, root=self.root, run=self.run_command)
        self.assertTrue(self.installed.is_dir())
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
