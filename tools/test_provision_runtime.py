import json
import stat
import tempfile
import unittest
from pathlib import Path

from provision_runtime import FIELDS, render


class ProvisionTests(unittest.TestCase):
    def test_private_credentials_are_retained_and_enrollment_matches(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch) / "runtime"
            environment = {key: "synthetic-fixture" for key in FIELDS.values()}
            render(root, environment)
            token = (root / "secrets/WWW_API_TOKEN").read_text()
            environment.update(
                CF_ACCESS_DEVICE_CLIENT_ID="device-fixture", CF_ACCESS_DEVICE_CLIENT_SECRET="secret-fixture"
            )
            enrollment = Path(scratch) / "private/enrollment.json"
            render(root, environment, enrollment)
            self.assertEqual(json.loads(enrollment.read_text())["apiToken"], token)
            for path in [enrollment, *list((root / "secrets").iterdir())]:
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_missing_credentials_do_not_create_partial_runtime(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch) / "runtime"
            with self.assertRaises(ValueError):
                render(root, {})
            self.assertFalse(root.exists())
            with self.assertRaises(ValueError):
                render(root, {key: "fixture" for key in FIELDS.values()}, Path(scratch) / "enrollment.json")
            self.assertFalse(root.exists())
