import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("proof", Path(__file__).with_name("apple-smoke-proof.py"))
proof = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof)

class ProofTests(unittest.TestCase):
    def setUp(self):
        self.repo = "owner/repo"
        self.source, self.head, self.tested = "a" * 40, "b" * 40, "c" * 40
        self.pull = {"merged_at": "now", "merge_commit_sha": self.source,
                     "base": {"ref": "main", "repo": {"full_name": self.repo}},
                     "head": {"sha": self.head, "repo": {"full_name": self.repo}}}
        self.run = {"id": 123, "event": "pull_request", "status": "completed", "conclusion": "success",
                    "head_sha": self.head, "head_repository": {"full_name": self.repo},
                    "path": ".github/workflows/apple-panel-testflight.yml"}
        self.job = {"id": 456, "name": "smoke", "conclusion": "success"}
        self.tree = "exact-tree"
        self.log = f"timestamp [command]/usr/local/bin/git log -1 --format=%H\ntimestamp {self.tested}\n"

    def api(self, path, raw=False):
        if path.endswith("/logs"): return self.log
        if "/git/commits/" in path:
            return {"tree": {"sha": self.tree if path.endswith(self.tested) else "exact-tree"}}
        if "/pulls?" in path: return [self.pull]
        if "/jobs?" in path: return {"jobs": [self.job]}
        return {"workflow_runs": [self.run]}

    def check(self): return proof.find_proof(self.api, self.repo, self.source)

    def test_identical_tree_can_reuse_squash_merge_smoke(self): self.assertEqual(self.check(), "123")
    def test_changed_tree_requires_tests(self):
        self.tree = "different"; self.assertEqual(self.check(), "")
    def test_only_merged_main_commit_can_reuse(self):
        for key, value in [("merged_at", None), ("merge_commit_sha", self.head)]:
            saved = self.pull[key]; self.pull[key] = value
            self.assertEqual(self.check(), ""); self.pull[key] = saved
    def test_failed_cancelled_wrong_workflow_or_head_is_rejected(self):
        for key, value in [("conclusion", "failure"), ("status", "in_progress"), ("event", "push"),
                           ("head_sha", self.tested), ("path", "other.yml")]:
            saved = self.run[key]; self.run[key] = value
            self.assertEqual(self.check(), ""); self.run[key] = saved
    def test_fork_run_is_rejected(self):
        self.run["head_repository"]["full_name"] = "fork/repo"; self.assertEqual(self.check(), "")
    def test_smoke_job_must_have_passed(self):
        self.job["conclusion"] = "cancelled"; self.assertEqual(self.check(), "")
    def test_missing_checkout_evidence_is_not_a_pass(self):
        self.log = f"anything {self.tested}\n"; self.assertEqual(self.check(), "")
    def test_checkout_hash_is_strict(self):
        self.log = "timestamp [command]/usr/bin/git log -1 --format=%H\ntimestamp $(evil)\n"
        self.assertEqual(self.check(), "")

if __name__ == "__main__": unittest.main()
