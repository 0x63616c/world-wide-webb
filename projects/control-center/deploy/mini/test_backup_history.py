"""Retention across years/DST, real restore checks and NAS failure safety."""

import datetime
import gzip
import io
import json
import os
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import backup


class HistoryTests(unittest.TestCase):
    def test_weekly_history_never_expires_and_local_sets_stay_bounded(self):
        end = datetime.datetime(2026, 11, 8, tzinfo=datetime.timezone.utc)
        stamps = [(end - datetime.timedelta(hours=i)).strftime("%Y%m%dT%H%M%SZ") for i in range(24 * 800)]
        local = backup.retained(stamps)
        remote = backup.retained(stamps, weekly=True)
        self.assertLessEqual(len(local), 31)
        self.assertGreater(len(remote), 110)
        self.assertTrue(local <= remote)
        self.assertTrue(any(s.startswith("2024") for s in remote))
        newest_24 = sorted(stamps)[-24:]
        self.assertTrue(set(newest_24) <= local)

    def test_fall_back_repeated_pacific_hours_are_distinct_snapshots(self):
        stamps = ["20261101T080000Z", "20261101T090000Z", "20261101T100000Z"]
        self.assertEqual(backup.retained(stamps), set(stamps))
        with self.assertRaises(ValueError):
            backup.retained(["../unrelated"])

    def test_local_expiration_works_without_nas_and_preserves_partial_evidence(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            end = datetime.datetime(2026, 11, 8, tzinfo=datetime.timezone.utc)
            for i in range(24 * 30):
                stamp = (end - datetime.timedelta(hours=i)).strftime("%Y%m%dT%H%M%SZ")
                p = root / stamp
                p.mkdir()
                (p / "COMPLETE.json").write_text("{}")
                (p / "NAS_VERIFIED").touch()
            backup.prune_history(root)
            self.assertLessEqual(len(backup.history_sets(root)), 31)
            self.assertTrue(any(p.name == "NAS_VERIFIED" for p in root.rglob("*")))

    def test_unuploaded_weekly_representatives_survive_extended_nas_outage(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            end = datetime.datetime(2026, 11, 8, tzinfo=datetime.timezone.utc)
            stamps = [(end - datetime.timedelta(hours=i)).strftime("%Y%m%dT%H%M%SZ") for i in range(24 * 60)]
            for stamp in stamps:
                p = root / stamp
                p.mkdir()
                (p / "COMPLETE.json").write_text("{}")
            keep = backup.retained(stamps, weekly=True)
            backup.prune_history(root)
            self.assertEqual({p.name for p in backup.history_sets(root)}, keep)
            for p in backup.history_sets(root):
                (p / "NAS_VERIFIED").touch()
            backup.prune_history(root)
            self.assertLessEqual(len(backup.history_sets(root)), 31)

    def test_dead_hourly_owner_is_recovered_without_touching_peer_deployments(self):
        with tempfile.TemporaryDirectory() as temp:
            lock = Path(temp) / "deploy.lock"
            lock.mkdir()
            (lock / "hourly-owner.json").write_text(json.dumps({"pid": 12345, "boot": "previous"}))
            with (
                patch.object(backup.subprocess, "check_output", return_value="current"),
                patch.object(backup.os, "kill", side_effect=ProcessLookupError),
            ):
                owner = backup.acquire_hourly_deploy_lock(lock)
            self.assertEqual(json.loads((lock / "hourly-owner.json").read_text()), owner)
            self.assertEqual(owner["boot"], "current")

    def test_stalled_nas_has_a_wall_clock_budget_below_the_hourly_interval(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with (
                patch.object(backup, "ROOT", root),
                patch.object(backup.subprocess, "run", side_effect=subprocess.TimeoutExpired("NAS", 900)) as run,
            ):
                with self.assertRaises(subprocess.TimeoutExpired):
                    backup.publish_history_bounded(root / "control-center-history")
                self.assertEqual(run.call_args.kwargs["timeout"], 900)
                self.assertTrue(run.call_args.kwargs["check"])

    def test_killed_hourly_process_does_not_leave_a_permanent_lock(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            p = root / "control-center-history" / stamp
            p.mkdir(parents=True)
            (p / "COMPLETE.json").write_text("{}")
            code = """import backup,os,sys
from pathlib import Path
from unittest.mock import Mock
backup.ROOT=Path(sys.argv[1])
backup.shutil.disk_usage=lambda _:Mock(free=10*1024**3)
backup.publish_history_bounded=lambda _:os._exit(7)
backup.hourly_backup()
"""
            env = dict(os.environ, PYTHONPATH=str(Path(backup.__file__).parent))
            killed = subprocess.run([sys.executable, "-c", code, str(root)], env=env, capture_output=True)
            self.assertEqual(killed.returncode, 7, killed.stderr.decode())
            with (
                patch.object(backup, "ROOT", root),
                patch.object(backup.shutil, "disk_usage", return_value=Mock(free=10 * 1024**3)),
            ):
                backup.hourly_backup(local_only=True)

    def test_one_damaged_upload_does_not_block_newer_good_snapshots_or_expire_history(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "nas-credentials.json").write_text("{}")
            (root / "nas-credentials.json").chmod(0o600)
            first = root / "20261107T100000Z"
            second = root / "20261107T110000Z"
            for p in [first, second]:
                p.mkdir()
                (p / "COMPLETE.json").write_text("{}")
            nas = Mock()
            nas.call.return_value = {"total": 0, "files": []}
            uploader = Mock()
            uploader.Nas.return_value = nas

            def execute(module):
                module.Nas = uploader.Nas

            spec = Mock()
            spec.loader.exec_module.side_effect = execute
            with (
                patch.object(backup, "ROOT", root),
                patch("importlib.util.spec_from_file_location", return_value=spec),
                patch("importlib.util.module_from_spec", return_value=uploader),
                patch.object(backup, "validate_history", side_effect=[RuntimeError("damaged"), 1]),
                patch.object(backup, "upload_once") as upload,
            ):
                with self.assertRaisesRegex(RuntimeError, "older pending"):
                    backup.publish_history(root)
            self.assertTrue((first / "UPLOAD_FAILED").is_file())
            self.assertTrue((second / "NAS_VERIFIED").is_file())
            self.assertEqual(upload.call_count, 3)
            self.assertFalse(any(call.args[0] == "SYNO.FileStation.Delete" for call in nas.call.call_args_list))

    def fixture(self, root, missing=False):
        raw = root / "source.sqlite"
        with sqlite3.connect(raw) as db:
            db.execute("CREATE TABLE booth_photo(path TEXT, bytes INTEGER)")
            db.execute("INSERT INTO booth_photo VALUES('fixture.jpg',3)")
        with raw.open("rb") as source, gzip.open(root / "control-center.sqlite.gz", "wb") as target:
            target.write(source.read())
        with tarfile.open(root / "media.tar.gz", "w:gz") as archive:
            if not missing:
                info = tarfile.TarInfo("./booth-photos/fixture.jpg")
                info.size = 3
                archive.addfile(info, io.BytesIO(b"jpg"))
        return raw

    def test_restore_validation_requires_every_photo_and_reads_compressed_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fixture(root)
            self.assertEqual(backup.validate_history(root), 1)
            with (root / "media.tar.gz").open("r+b") as target:
                target.seek(-1, 2)
                target.write(b"\xff")
            with self.assertRaises((OSError, EOFError)):
                backup.validate_history(root)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fixture(root, missing=True)
            with self.assertRaisesRegex(RuntimeError, "missing indexed"):
                backup.validate_history(root)

    def test_dsm_batch_missing_path_is_absent_and_permission_errors_fail_closed(self):
        nas = Mock()
        path = backup.HISTORY_REMOTE + "/20261108T054922Z/control-center.sqlite.gz"
        nas.call.return_value = {"files": [{"code": 408, "path": path}]}
        self.assertFalse(backup.nas_exists(nas, path))
        nas.call.return_value = {"files": [{"code": 407, "path": path}]}
        with self.assertRaisesRegex(RuntimeError, "metadata error"):
            backup.nas_exists(nas, path)
        nas.call.return_value = {"files": [{"path": path, "isdir": False}]}
        self.assertTrue(backup.nas_exists(nas, path))
        with tempfile.TemporaryDirectory() as temp:
            payload = Path(temp) / "control-center.sqlite.gz"
            payload.write_bytes(b"fixture")
            nas.call.return_value = {"files": [{"code": 408, "path": path}]}
            backup.upload_once(nas, payload, backup.HISTORY_REMOTE + "/20261108T054922Z")
            nas.upload.assert_called_once()

    def test_upload_resume_never_overwrites_different_remote_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "media.tar.gz"
            path.write_bytes(b"fixture")
            nas = Mock()
            nas.download_hash.return_value = (backup.file_digest(path), path.stat().st_size)
            with patch.object(backup, "nas_exists", return_value=True):
                backup.upload_once(nas, path, "/dedicated")
                nas.upload.assert_not_called()
                nas.download_hash.return_value = ("wrong", 1)
                with self.assertRaisesRegex(RuntimeError, "refusing overwrite"):
                    backup.upload_once(nas, path, "/dedicated")
                nas.upload.assert_not_called()

    def test_nas_outage_keeps_hourly_local_complete_and_releases_lock(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            p = root / "control-center-history" / stamp
            p.mkdir(parents=True)
            (p / "COMPLETE.json").write_text("{}")
            with (
                patch.object(backup, "ROOT", root),
                patch.object(backup.shutil, "disk_usage", return_value=Mock(free=10 * 1024**3)),
                patch.object(backup, "create_history") as create,
                patch.object(backup, "publish_history_bounded", side_effect=TimeoutError("NAS offline")),
            ):
                with self.assertRaises(TimeoutError):
                    backup.hourly_backup()
                create.assert_not_called()
            self.assertTrue((p / "COMPLETE.json").is_file())
            self.assertFalse((p.parent / "backup.lock").exists())

    def test_full_backups_remain_bounded_even_without_successful_uploads(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for day in range(1, 20):
                p = root / f"202610{day:02d}T120000Z"
                p.mkdir()
                (p / "LOCAL_VERIFIED").touch()
            (root / "native-rust-cutover-preserve").mkdir()
            backup.prune_full_sets(root)
            self.assertEqual(len([p for p in root.iterdir() if backup.STAMP.fullmatch(p.name)]), 7)
            self.assertTrue((root / "native-rust-cutover-preserve").is_dir())

    def test_archive_member_list_does_not_reference_removed_operations_files(self):
        # Run the real tar command: mocked archives missed the retired helper reference.
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name in backup.OPERATIONS_FILES:
                self.assertTrue(Path(backup.__file__).with_name(name).is_file())
            backup.archive(root / "ops.tar.gz", Path(backup.__file__).parent, *backup.OPERATIONS_FILES)
            with tarfile.open(root / "ops.tar.gz") as archive:
                self.assertTrue(set(backup.OPERATIONS_FILES) <= set(archive.getnames()))


if __name__ == "__main__":
    unittest.main()
