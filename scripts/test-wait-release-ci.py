#!/usr/bin/env python3
"""Publishing must wait for successful CI on the requested main revision."""
import contextlib
import io
import json
import os
from pathlib import Path
import runpy
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("wait-release-ci.py")


class SourceCIGateTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ, {"GITHUB_REPOSITORY": "owner/apps", "GITHUB_SHA": "exact-revision"})
        environment.start()
        self.addCleanup(environment.stop)

    def test_queued_revision_must_finish_successfully(self):
        replies = [[], [{"status": "in_progress"}], [{"status": "completed", "conclusion": "success", "url": "https://github.com/owner/apps/actions/runs/1"}]]
        with patch("subprocess.check_output", side_effect=[json.dumps(rows) for rows in replies]) as gh, patch("time.sleep") as sleep, contextlib.redirect_stdout(io.StringIO()) as output:
            runpy.run_path(str(SCRIPT))
        command = gh.call_args.args[0]
        for option, value in (("--repo", "owner/apps"), ("--commit", "exact-revision"), ("--branch", "main"), ("--event", "push"), ("--workflow", "tendr-ci.yml")):
            self.assertEqual(command[command.index(option) + 1], value)
        self.assertEqual(sleep.call_count, 2)
        self.assertIn("Source CI passed", output.getvalue())

    def test_failed_or_cancelled_source_never_passes(self):
        for conclusion in ("failure", "cancelled"):
            with self.subTest(conclusion=conclusion), patch("subprocess.check_output", return_value=json.dumps([{"status": "completed", "conclusion": conclusion, "url": "run"}])), patch("time.sleep") as sleep:
                with self.assertRaisesRegex(SystemExit, "Source CI did not pass"):
                    runpy.run_path(str(SCRIPT))
                sleep.assert_not_called()

    def test_missing_source_times_out_without_publishing(self):
        with patch("subprocess.check_output", return_value="[]") as gh, patch("time.sleep"):
            with self.assertRaisesRegex(SystemExit, "no release uploaded"):
                runpy.run_path(str(SCRIPT))
        self.assertEqual(gh.call_count, 160)


if __name__ == "__main__":
    unittest.main()
