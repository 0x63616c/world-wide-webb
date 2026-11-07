import stat
import tempfile
import unittest
from pathlib import Path

from provision_runtime import FIELDS, render


class ProvisionTests(unittest.TestCase):
    def test_only_server_integration_secrets_are_rendered_privately(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch) / "runtime"
            render(root, {key: "synthetic-fixture" for key in FIELDS.values()})
            self.assertEqual({p.name for p in (root / "secrets").iterdir()}, set(FIELDS))
            self.assertFalse((root / "secrets/WWW_API_TOKEN").exists())
            for path in (root / "secrets").iterdir():
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_missing_credentials_do_not_create_partial_runtime(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch) / "runtime"
            with self.assertRaises(ValueError):
                render(root, {})
            self.assertFalse(root.exists())
