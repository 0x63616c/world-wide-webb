"""Ensure a failed Penpot snapshot cannot strand either writer stopped."""

import importlib.util
import subprocess
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("penpot_backup", Path(__file__).with_name("penpot_backup.py"))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupSafety(unittest.TestCase):
    def test_snapshot_failure_restarts_both_writers(self):
        with patch.object(backup, "docker", return_value=Mock(stdout="true\n")) as docker:
            with self.assertRaisesRegex(RuntimeError, "disk full"):
                with backup.quiesced():
                    raise RuntimeError("disk full")
        self.assertEqual(
            [c.args for c in docker.call_args_list if c.args[0] == "start"],
            [("start", "penpot-penpot-backend-1"), ("start", "penpot-penpot-exporter-1")],
        )

    def test_preexisting_stopped_writer_prevents_any_stops(self):
        with patch.object(backup, "docker", side_effect=[Mock(stdout="true"), Mock(stdout="false")]) as docker:
            with self.assertRaisesRegex(RuntimeError, "already stopped"):
                with backup.quiesced():
                    self.fail("must not snapshot")
        self.assertFalse(any(c.args[0] == "stop" for c in docker.call_args_list))

    def test_failed_restart_does_not_skip_second_writer(self):
        def command(*args, **kwargs):
            if args == ("start", "penpot-penpot-backend-1"):
                raise subprocess.CalledProcessError(1, args)
            return Mock(stdout="true")

        with patch.object(backup, "docker", side_effect=command) as docker:
            with self.assertRaisesRegex(RuntimeError, "Failed to restart"):
                with backup.quiesced():
                    pass
        self.assertEqual(docker.call_args_list[-1].args, ("start", "penpot-penpot-exporter-1"))


if __name__ == "__main__":
    unittest.main()
