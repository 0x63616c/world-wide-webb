"""Real SQLite restore, interrupted replication, protected pruning and age-based NAS retention."""

import datetime
import gzip
import hashlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import backup
import sqlite_snapshot


class FakeNas:
    def __init__(self):
        self.files = {}
        self.uploads = []
        self.deletions = []
        self.fail_manifest = False

    def upload(self, path, destination):
        if self.fail_manifest and path.name == "COMPLETE.json":
            raise TimeoutError("NAS interrupted")
        key = destination + "/" + path.name
        if key in self.files:
            raise AssertionError("Must not overwrite NAS bytes")
        self.files[key] = path.read_bytes()
        self.uploads.append(key)

    def download_hash(self, path):
        data = self.files[path]
        return hashlib.sha256(data).hexdigest(), len(data)

    def call(self, api, method, **kwargs):
        if api == "SYNO.FileStation.Delete":
            self.deletions.extend(json.loads(kwargs["path"]))
            return {}
        if method == "getinfo":
            path = json.loads(kwargs["path"])[0]
            return {"files": [{"path": path}] if path in self.files else [{"path": path, "code": 408}]}
        root = kwargs["folder_path"]
        names = sorted({key[len(root) + 1 :].split("/")[0] for key in self.files if key.startswith(root + "/")})
        return {"total": len(names), "files": [{"name": n, "path": root + "/" + n, "isdir": True} for n in names]}


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.root = self.home / "www-control-center/backups"
        self.root.mkdir(parents=True)
        self.now = datetime.datetime(2026, 11, 8, 12, tzinfo=datetime.timezone.utc)
        patcher = patch.object(backup, "HOME", self.home)
        patcher.start()
        self.addCleanup(patcher.stop)

    def snapshot(self, ago=0, recovery=False, generation=1):
        stamp = (self.now - datetime.timedelta(days=ago)).strftime("%Y%m%dT%H%M%SZ")
        name = (
            f"before-recovery-{stamp}-{generation}.sqlite"
            if recovery
            else f"before-release-{generation}-{'a' * 40}-{stamp}-{generation}.sqlite"
        )
        path = self.root / name
        with sqlite3.connect(path) as db:
            db.execute("CREATE TABLE records(id TEXT PRIMARY KEY,value TEXT)")
            db.execute("INSERT INTO records VALUES('keep_id','preserved')")
        return path

    def receipt(self, path):
        Path(str(path) + ".NAS_VERIFIED").write_text(
            json.dumps({"file": path.name, "bytes": path.stat().st_size, "sha256": backup.file_digest(path)})
        )

    def test_interrupted_upload_reuses_bytes_and_only_verified_copies_allow_pruning(self):
        source = self.snapshot()
        nas = FakeNas()
        nas.fail_manifest = True
        with self.assertRaises(RuntimeError):
            backup.publish_deployments(nas, now=self.now)
        self.assertFalse(sqlite_snapshot.release_snapshot_verified(source))
        stage = self.root / ".nas-pending" / source.stem
        first = (stage / "control-center.sqlite.gz").read_bytes()
        self.assertEqual(len(nas.uploads), 1)
        nas.fail_manifest = False
        backup.publish_deployments(nas, now=self.now)
        self.assertEqual(len(nas.uploads), 2)  # existing payload verified; only manifest uploaded
        self.assertTrue(sqlite_snapshot.release_snapshot_verified(source))
        self.assertFalse(stage.exists())
        raw = self.home / "restored.sqlite"
        raw.write_bytes(gzip.decompress(first))
        with sqlite3.connect(raw) as db:
            self.assertEqual(db.execute("PRAGMA integrity_check").fetchall(), [("ok",)])
            self.assertEqual(db.execute("SELECT * FROM records").fetchall(), [("keep_id", "preserved")])

    def test_nas_retention_is_seven_days_and_includes_recovery(self):
        old = self.snapshot(ago=8)
        boundary = self.snapshot(ago=7, recovery=True)
        fresh = self.snapshot(ago=0, generation=2)
        nas = FakeNas()
        unrelated = backup.DEPLOYMENT_REMOTE + "/incident-manual/COMPLETE.json"
        nas.files[unrelated] = b"retained"
        backup.publish_deployments(nas, now=self.now)
        self.assertEqual(nas.deletions, [backup.DEPLOYMENT_REMOTE + "/" + old.stem])
        self.assertTrue(sqlite_snapshot.release_snapshot_verified(fresh))
        self.assertTrue(sqlite_snapshot.release_snapshot_verified(boundary))
        self.assertIn(unrelated, nas.files)

    def test_pending_and_modified_copies_survive_local_retention(self):
        sources = [self.snapshot(ago=i, generation=i + 1) for i in range(12)]
        sqlite_snapshot.prune_release_snapshots(self.root)
        self.assertTrue(all(p.exists() for p in sources))
        for source in sources:
            self.receipt(source)
        # A receipt for different bytes must not authorize deletion.
        sources[-1].write_bytes(b"unexpected change")
        sqlite_snapshot.prune_release_snapshots(self.root)
        self.assertTrue(sources[-1].exists())
        self.assertEqual(len(list(self.root.glob("*.sqlite"))), 8)  # newest 7 + protected damaged copy

    def test_bad_old_snapshot_does_not_block_a_new_good_copy(self):
        old = self.snapshot(ago=2)
        old.write_bytes(b"not SQLite")
        fresh = self.snapshot(ago=0, generation=2)
        nas = FakeNas()
        with self.assertRaisesRegex(RuntimeError, "Older deployment"):
            backup.publish_deployments(nas, now=self.now)
        self.assertFalse(sqlite_snapshot.release_snapshot_verified(old))
        self.assertTrue(sqlite_snapshot.release_snapshot_verified(fresh))

    def test_failed_deployment_stream_does_not_block_hourly_photo_stream(self):
        with (
            patch.object(backup, "nas_session") as session,
            patch.object(backup, "publish_hourly_history") as hourly,
            patch.object(backup, "publish_deployments", side_effect=TimeoutError),
        ):
            session.return_value.__enter__.return_value = FakeNas()
            with self.assertRaises(TimeoutError):
                backup.publish_history(self.home)
            hourly.assert_called_once()

    def test_capture_failure_still_attempts_pending_nas_replication(self):
        with (
            patch.object(backup, "ROOT", self.home),
            patch.object(backup, "create_history", side_effect=RuntimeError("capture failed")),
            patch.object(backup, "publish_history_bounded") as publish,
        ):
            with self.assertRaisesRegex(RuntimeError, "capture failed"):
                backup.hourly_backup()
            publish.assert_called_once()

    def test_stale_incomplete_compression_is_reclaimed_before_space_checks(self):
        source = self.snapshot()
        stage = self.root / ".nas-pending" / source.stem
        stage.mkdir(parents=True)
        partial = stage / "control-center.sqlite.gz.partial"
        partial.write_bytes(b"interrupted")

        def space(_):
            self.assertFalse(partial.exists())
            return type("Disk", (), {"free": 0})()

        with patch.object(backup.shutil, "disk_usage", side_effect=space):
            with self.assertRaisesRegex(RuntimeError, "reserve"):
                backup.stage_deployment(source)
        self.assertTrue(source.exists())

    def test_manual_names_invalid_dates_and_symlinks_are_never_selected(self):
        valid = self.snapshot()
        (self.root / "before-release-manual.sqlite").write_bytes(b"preserve")
        bad = self.root / f"before-release-1-{'b' * 40}-20261399T120000Z-1.sqlite"
        bad.write_bytes(b"preserve")
        (self.root / f"before-release-2-{'b' * 40}-20261108T120000Z-2.sqlite").symlink_to(valid)
        self.assertEqual(backup.deployment_snapshots(self.root), [valid])


if __name__ == "__main__":
    unittest.main()
