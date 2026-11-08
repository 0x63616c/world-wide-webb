"""Real SQLite WAL and cutover failure behavior, without production access."""

import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlite_snapshot import read_database

spec = importlib.util.spec_from_file_location("cutover_backup", Path(__file__).with_name("cutover-backup.py"))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class CutoverBackupTests(unittest.TestCase):
    def test_sqlite_snapshot_includes_committed_wal_and_never_overwrites(self):
        with tempfile.TemporaryDirectory() as temp:
            source, target = Path(temp) / "live.sqlite", Path(temp) / "backup.sqlite"
            with sqlite3.connect(source) as db:
                db.execute("PRAGMA journal_mode=WAL")
                db.execute("CREATE TABLE records (id TEXT PRIMARY KEY, value TEXT)")
                db.execute("INSERT INTO records VALUES (?, ?)", ("existing_id", "preserved"))
                db.commit()
                backup.sqlite_snapshot(source, target)
                with sqlite3.connect(target) as restored:
                    self.assertEqual(
                        restored.execute("SELECT * FROM records").fetchall(), [("existing_id", "preserved")]
                    )
                with self.assertRaises(FileExistsError):
                    backup.sqlite_snapshot(source, target)

    def test_read_database_rejects_sql_writes_and_missing_files(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source.sqlite"
            with self.assertRaises(FileNotFoundError), read_database(source):
                self.fail("A missing database must never be created")
            self.assertFalse(source.exists())
            db = sqlite3.connect(source)
            db.execute("CREATE TABLE records(id INTEGER)")
            db.close()
            with read_database(source) as reader:
                with self.assertRaises(sqlite3.OperationalError):
                    reader.execute("INSERT INTO records VALUES (1)")
                self.assertEqual(reader.execute("SELECT count(*) FROM records").fetchone(), (0,))

    def test_retired_sqlite_cutover_cannot_snapshot_stale_host_data_or_stop_the_app(self):
        with tempfile.TemporaryDirectory() as temp:
            app, dest = Path(temp) / "app", Path(temp) / "snapshot"
            app.mkdir()
            with patch.object(backup.subprocess, "run") as run:
                with self.assertRaisesRegex(ValueError, "retired"):
                    backup.snapshot(app, dest, "sqlite")
                run.assert_not_called()
            self.assertFalse(dest.exists())
            self.assertFalse((app / "deploy.lock").exists())

    def test_failure_keeps_writer_stopped_and_lock_owned(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp) / "app"
            app.mkdir()
            dest = Path(temp) / "snapshot"
            with (
                patch.object(backup.subprocess, "check_output", side_effect=["true", "false"]),
                patch.object(backup.subprocess, "run", side_effect=[None, RuntimeError("dump failure")]) as run,
            ):
                with self.assertRaises(RuntimeError):
                    backup.snapshot(app, dest, "postgres")
            self.assertTrue((app / "deploy.lock/cutover.json").exists())
            self.assertTrue((dest / "cutover.json").exists())
            self.assertFalse(any("start" in call.args[0] for call in run.call_args_list))
            backup.release_lock(app, dest)
            self.assertFalse((app / "deploy.lock").exists())

    def test_does_not_steal_existing_lock(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp) / "app"
            (app / "deploy.lock").mkdir(parents=True)
            with patch.object(backup.subprocess, "run") as run:
                with self.assertRaises(FileExistsError):
                    backup.snapshot(app, Path(temp) / "snapshot", "postgres")
                run.assert_not_called()

    def test_release_rejects_different_owner(self):
        with tempfile.TemporaryDirectory() as temp:
            app, dest = Path(temp) / "app", Path(temp) / "snapshot"
            (app / "deploy.lock").mkdir(parents=True)
            dest.mkdir()
            (app / "deploy.lock/cutover.json").write_text(json.dumps({"owner": "first"}))
            (dest / "cutover.json").write_text(json.dumps({"owner": "second"}))
            with self.assertRaises(RuntimeError):
                backup.release_lock(app, dest)
            self.assertTrue((app / "deploy.lock").exists())


if __name__ == "__main__":
    unittest.main()
