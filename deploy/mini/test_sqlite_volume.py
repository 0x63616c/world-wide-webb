"""Storage boundaries and stopped-writer copy tests; no production Docker access."""

import io
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sqlite_preflight as preflight
import sqlite_snapshot as volume


class VolumeTests(unittest.TestCase):
    def info(self, running=False, kind="volume"):
        return [
            {
                "State": {"Running": running},
                "Mounts": [{"Destination": "/app/data", "Type": kind, "Name": volume.VOLUME}],
            }
        ]

    def test_running_writer_and_host_bind_mount_are_never_copied(self):
        for info in [self.info(running=True), self.info(kind="bind")]:
            with (
                patch.object(volume.subprocess, "check_output", return_value=json.dumps(info)),
                patch.object(volume.subprocess, "run") as run,
            ):
                with self.assertRaises(RuntimeError):
                    volume.snapshot_container("www", Path("unused"))
                run.assert_not_called()

    def test_network_volume_driver_or_options_are_rejected(self):
        for info in [{"Driver": "nfs", "Options": {}}, {"Driver": "local", "Options": {"type": "nfs"}}]:
            with patch.object(volume.subprocess, "check_output", return_value=json.dumps([info])):
                with self.assertRaises(RuntimeError):
                    volume.inspect_volume(volume.VOLUME)

    def test_old_rollback_image_cannot_run_as_a_live_validator(self):
        config = {
            "services": {
                "www": {
                    "image": "old-target",
                    "user": "501:20",
                    "ports": [{"host_ip": "127.0.0.1", "target": 4201, "published": "4202"}],
                    "volumes": [{"type": "volume", "source": "sqlite", "target": "/app/data"}],
                }
            },
            "volumes": {"sqlite": {"external": True, "name": volume.VOLUME}},
        }
        with (
            patch.object(sys, "stdin", io.StringIO(json.dumps(config))),
            patch.object(sys, "argv", ["preflight", "accepted-validator"]),
            patch.object(preflight, "inspect_volume"),
            patch.object(preflight.subprocess, "check_output", return_value='{"databaseCheck":true}') as caps,
            patch.object(preflight.subprocess, "run") as run,
        ):
            preflight.main()
            self.assertIn("accepted-validator", caps.call_args.args[0])
            self.assertNotIn("--mount", caps.call_args.args[0])
            self.assertIn("--read-only", caps.call_args.args[0])
            self.assertIn("accepted-validator", run.call_args.args[0])
            self.assertNotIn("old-target", run.call_args.args[0])
        with (
            patch.object(sys, "stdin", io.StringIO(json.dumps(config))),
            patch.object(sys, "argv", ["preflight"]),
            patch.object(preflight, "inspect_volume"),
            patch.object(preflight.subprocess, "check_output", return_value="{}"),
            patch.object(preflight.subprocess, "run") as run,
        ):
            with self.assertRaises(RuntimeError):
                preflight.main()
            run.assert_not_called()

    def test_stopped_copy_includes_wal_and_does_not_touch_the_source(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source.sqlite"
            target = Path(temp) / "backup.sqlite"
            db = sqlite3.connect(source)
            self.addCleanup(db.close)
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("CREATE TABLE records(value TEXT)")
            db.execute("INSERT INTO records VALUES ('committed in WAL')")
            db.commit()

            def copy(command, **kwargs):
                import shutil

                copied = Path(command[-1])
                for suffix in ["", "-wal", "-shm"]:
                    p = Path(str(source) + suffix)
                    if p.exists():
                        shutil.copyfile(p, copied / ("control-center.sqlite" + suffix))

            with (
                patch.object(
                    volume.subprocess,
                    "check_output",
                    side_effect=[json.dumps(self.info()), json.dumps([{"Driver": "local", "Options": None}])],
                ),
                patch.object(volume.subprocess, "run", side_effect=copy),
            ):
                volume.snapshot_container("www", target)
            with sqlite3.connect(target) as restored:
                self.assertEqual(restored.execute("SELECT * FROM records").fetchall(), [("committed in WAL",)])
            self.assertEqual(db.execute("SELECT * FROM records").fetchall(), [("committed in WAL",)])
            with self.assertRaises(FileExistsError):
                # Snapshot primitive refuses to overwrite retained recovery data.
                volume.sqlite_snapshot(source, target)


if __name__ == "__main__":
    unittest.main()
