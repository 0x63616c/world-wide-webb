import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("resume", Path(__file__).with_name("resume-release.py"))
resume = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resume)


class ResumeTest(unittest.TestCase):
    def pending(self, states):
        runs = [{"databaseId": i, "status": "completed"} for i in range(len(states))]
        return resume.pending_state(runs, lambda i: [] if states[i] is None else [{"id": i, "name": "release-state", "expired": False}], lambda i: {"state": states[i], "app": "tendr"})

    def test_latest_submission_supersedes_old_deferral(self):
        self.assertIsNone(self.pending([None, "submitted", "deferred"]))

    def test_noop_run_does_not_lose_queued_update(self):
        self.assertEqual("deferred", self.pending([None, "deferred", "submitted"])["state"])

    def test_in_progress_release_prevents_duplicate_dispatch(self):
        self.assertIsNone(resume.pending_state([{"status": "in_progress"}], lambda _: self.fail(), lambda _: self.fail()))

    def test_hundreds_of_noop_merges_cannot_hide_a_queued_update(self):
        pages = [list(range(100)), [100]]

        def response(*_args):
            return json.dumps({"workflow_runs": [{"id": i, "status": "completed"} for i in pages.pop(0)]}).encode()

        with patch.object(resume, "gh", side_effect=response) as gh:
            pending = resume.pending_state(resume.workflow_runs("owner/repo"),
                lambda i: [] if i < 100 else [{"id": i, "name": "release-state", "expired": False}],
                lambda _: {"state": "deferred", "app": "tendr"})
            self.assertEqual("deferred", pending["state"])
            self.assertEqual(2, gh.call_count)

    def test_recent_decision_does_not_read_older_pages(self):
        batch = {"workflow_runs": [{"id": i, "status": "completed"} for i in range(100)]}
        with patch.object(resume, "gh", return_value=json.dumps(batch).encode()) as gh:
            pending = resume.pending_state(resume.workflow_runs("owner/repo"),
                lambda i: [{"id": i, "name": "release-state", "expired": False}],
                lambda _: {"state": "submitted", "app": "tendr"})
            self.assertIsNone(pending)
            self.assertEqual(1, gh.call_count)


if __name__ == "__main__":
    unittest.main()
