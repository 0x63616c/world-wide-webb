"""Failure-path safety checks; run with python3 -m unittest discover -s deploy/mini."""

import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


backup = load("backup", "backup.py")
upload = load("nas_upload", "nas-upload.py")


class BackupSafety(unittest.TestCase):
    def test_expired_upload_session_refreshes_once(self):
        nas = upload.Nas({})
        with (
            patch.object(nas, "_upload", side_effect=[upload.NasApiError("upload", 119), {"verified": True}]) as send,
            patch.object(nas, "login") as login,
        ):
            self.assertEqual(nas.upload(Path("backup.dump"), "/destination"), {"verified": True})
        login.assert_called_once()
        self.assertEqual(send.call_count, 2)

    def test_repeated_session_rejection_stops_after_one_refresh(self):
        nas = upload.Nas({})
        with (
            patch.object(nas, "_upload", side_effect=upload.NasApiError("upload", 119)) as send,
            patch.object(nas, "login") as login,
        ):
            with self.assertRaises(upload.NasApiError):
                nas.upload(Path("backup.dump"), "/destination")
        login.assert_called_once()
        self.assertEqual(send.call_count, 2)

    def test_other_upload_errors_are_not_replayed(self):
        nas = upload.Nas({})
        with (
            patch.object(nas, "_upload", side_effect=upload.NasApiError("upload", 414)) as send,
            patch.object(nas, "login") as login,
        ):
            with self.assertRaises(upload.NasApiError):
                nas.upload(Path("backup.dump"), "/destination")
        login.assert_not_called()
        send.assert_called_once()

    def test_snapshot_failure_still_restarts_service(self):
        with patch.object(backup.subprocess, "check_output", return_value="true"), patch.object(backup, "run") as run:
            with self.assertRaisesRegex(RuntimeError, "disk full"):
                with backup.stopped("orbstack", "service"):
                    raise RuntimeError("disk full")
            self.assertEqual(run.call_args_list[-1].args[0][-2:], ["start", "service"])

    def test_does_not_start_a_previously_stopped_service(self):
        with patch.object(backup.subprocess, "check_output", return_value="false"), patch.object(backup, "run") as run:
            with self.assertRaises(RuntimeError):
                with backup.stopped("orbstack", "service"):
                    self.fail("must not enter snapshot")
            run.assert_not_called()

    def test_nas_failure_retains_verified_local_set_and_releases_lock(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with (
                patch.object(backup, "ROOT", root),
                patch.object(backup.shutil, "disk_usage", return_value=Mock(free=10 * 1024**3)),
                patch.object(backup, "snapshot") as snapshot,
                patch.object(backup, "verify_restarted_services") as healthy,
                patch.object(backup, "run", side_effect=TimeoutError("NAS offline")),
            ):
                with self.assertRaises(TimeoutError):
                    backup.main([])
                snapshot.assert_called_once()
                healthy.assert_called_once()
            sets = [p for p in root.iterdir() if p.is_dir()]
            self.assertEqual(len(sets), 1)
            self.assertTrue((sets[0] / "LOCAL_VERIFIED").is_file())
            self.assertFalse((sets[0] / "NAS_VERIFIED").exists())
            self.assertFalse((root / "backup.lock").exists())

    def test_local_only_backup_never_contacts_nas(self):
        with tempfile.TemporaryDirectory() as temp:
            with (
                patch.object(backup, "ROOT", Path(temp)),
                patch.object(backup.shutil, "disk_usage", return_value=Mock(free=10 * 1024**3)),
                patch.object(backup, "snapshot"),
                patch.object(backup, "verify_restarted_services"),
                patch.object(backup, "run") as run,
            ):
                backup.main(["--local-only"])
                run.assert_not_called()
                self.assertEqual(len(list(Path(temp).glob("*/LOCAL_VERIFIED"))), 1)

    def test_wrong_nas_certificate_sends_no_credentials(self):
        connection = Mock()
        connection.sock.getpeercert.return_value = b"unexpected certificate"
        config = dict(host="nas.test", certificate_sha256="0" * 64, username="test-user", password="test-value")
        with patch.object(upload.http.client, "HTTPSConnection", return_value=connection):
            with self.assertRaisesRegex(RuntimeError, "pin mismatch"):
                upload.Nas(config).login()
        connection.request.assert_not_called()
        connection.send.assert_not_called()
        connection.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
