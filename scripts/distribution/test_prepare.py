import importlib.util
import os
import plistlib
import subprocess
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("prepare", Path(__file__).with_name("prepare.py"))
prepare = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prepare)


class ArtifactTransportTests(unittest.TestCase):
    def test_signed_bundle_metadata_must_bind_the_exact_source_version_and_production_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory) / "Callkeep.app"
            (app / "Contents").mkdir(parents=True)
            expected = {
                "CFBundleIdentifier": "co.calum.callkeep",
                "CallkeepSourceCommit": "a" * 40,
                "CFBundleShortVersionString": "1.0.26",
                "CFBundleVersion": "26",
                "CallkeepProduction": "YES",
            }
            path = app / "Contents/Info.plist"
            path.write_bytes(plistlib.dumps(expected))
            prepare.validate_callkeep_identity(app, "a" * 40, "1.0.26")
            for field, value in [
                ("CallkeepSourceCommit", "b" * 40),
                ("CFBundleShortVersionString", "1.0.25"),
                ("CFBundleVersion", "25"),
                ("CallkeepProduction", "NO"),
                ("CFBundleIdentifier", "other"),
            ]:
                with self.subTest(field=field):
                    path.write_bytes(plistlib.dumps(dict(expected, **{field: value})))
                    with self.assertRaisesRegex(ValueError, "identity"):
                        prepare.validate_callkeep_identity(app, "a" * 40, "1.0.26")

    def test_git_transport_preserves_bytes_executables_and_symlinks_without_source_history(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payload = root / "payload"
            (payload / "bin").mkdir(parents=True)
            binary = payload / "bin/homelab"
            binary.write_bytes(b"synthetic prebuilt binary\0\xff")
            binary.chmod(0o755)
            (payload / "bin/hl").symlink_to("homelab")
            args = dict(source="a" * 40, timestamp="1794160000", product="homelab", version="0.4.2")
            first = prepare.assemble(payload, root / "first", **args)
            second = prepare.assemble(payload, root / "second", **args)
            self.assertEqual(first["commit"], second["commit"])
            self.assertEqual((root / "first/export/bin/homelab").read_bytes(), binary.read_bytes())
            self.assertTrue(os.access(root / "first/export/bin/homelab", os.X_OK))
            self.assertEqual(os.readlink(root / "first/export/bin/hl"), "homelab")
            parents = subprocess.check_output(
                ["git", "show", "-s", "--format=%P", first["commit"]], cwd=first["repository"], text=True
            ).strip()
            self.assertEqual(parents, "")

    def test_escaping_symlinks_are_rejected_before_creating_distribution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payload = root / "payload"
            payload.mkdir()
            (root / "private-data").write_text("must not enter the artifact")
            (payload / "escaped").symlink_to("../private-data")
            with self.assertRaisesRegex(ValueError, "escapes"):
                prepare.assemble(
                    payload,
                    root / "output",
                    source="a" * 40,
                    timestamp="1794160000",
                    product="homelab",
                    version="0.4.2",
                )
            self.assertFalse((root / "output").exists())

    def test_full_source_checkouts_cannot_be_packaged_as_binaries(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "src").mkdir()
            (root / "src/main.rs").write_text("fn main() {}")
            with self.assertRaisesRegex(ValueError, "prebuilt"):
                prepare.validate_payload(root, "homelab")


if __name__ == "__main__":
    unittest.main()
