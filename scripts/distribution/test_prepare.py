import importlib.util
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("prepare", Path(__file__).with_name("prepare.py"))
prepare = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prepare)


class ArtifactTransportTests(unittest.TestCase):
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
