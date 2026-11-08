import importlib.util
from pathlib import Path
import unittest

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


if __name__ == "__main__":
    unittest.main()
