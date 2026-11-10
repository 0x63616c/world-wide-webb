import copy
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
SPEC = importlib.util.spec_from_file_location("delivery", Path(__file__).with_name("deliver.py"))
d = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(d)


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        selected = patch.object(
            d,
            "load_selection",
            return_value={
                "head": "a" * 40,
                "event": "push",
                "delivery_candidates": ["homelab.config"],
            },
        )
        selected.start()
        self.addCleanup(selected.stop)
        manifest = patch.object(
            d,
            "source_manifest",
            return_value={"schema": 3, "deployment": {"repository": d.REPOSITORY, "branch": "deploy/homelab"}},
        )
        manifest.start()
        self.addCleanup(manifest.stop)
        self.intent = {"source": "a" * 40, "inputs": "b" * 64, "run_id": 42, "attempt": 3}
        self.run = {
            "id": 42,
            "run_attempt": 3,
            "head_sha": "a" * 40,
            "head_branch": "main",
            "head_repository": {"full_name": d.REPOSITORY},
            "path": ".github/workflows/ci.yml",
            "event": "push",
            "status": "completed",
            "conclusion": "success",
        }
        self.jobs = [
            {"name": name, "status": "completed", "conclusion": "success"}
            for name in (
                "Homelab / Homelab selection",
                "Homelab / Homelab operations",
                "Homelab / Homelab Linux controller",
                "Homelab / Homelab Darwin configuration",
                "Homelab / Homelab checks",
            )
        ]

    def test_source_read_failure_does_not_copy_private_git_diagnostics(self):
        import subprocess

        result = subprocess.CompletedProcess([], 1, "", "SYNTHETIC_PRIVATE_BANNER")
        with patch.object(d.subprocess, "run", return_value=result):
            with self.assertRaises(RuntimeError) as failure:
                d.source_configuration("a" * 40)
        self.assertNotIn("PRIVATE", str(failure.exception))

    def test_exact_success_is_required_not_aggregate_alone(self):
        d.validate_ci(self.intent, self.run, self.jobs)
        for index in range(len(self.jobs)):
            for result in ("skipped", "cancelled", "failure", None):
                jobs = copy.deepcopy(self.jobs)
                jobs[index]["conclusion"] = result
                with self.assertRaises(ValueError):
                    d.validate_ci(self.intent, self.run, jobs)
        with self.assertRaises(ValueError):
            d.validate_ci(self.intent, self.run, self.jobs + [self.jobs[0]])

    def test_source_attempt_and_trust_mismatches_fail(self):
        for key, value in [
            ("id", 43),
            ("run_attempt", 2),
            ("head_sha", "c" * 40),
            ("head_branch", "other"),
            ("head_repository", {"full_name": "fork/repo"}),
            ("path", ".github/workflows/other.yml"),
            ("event", "pull_request"),
            ("status", "in_progress"),
            ("conclusion", "failure"),
        ]:
            run = dict(self.run, **{key: value})
            with self.assertRaises(ValueError, msg=key):
                d.validate_ci(self.intent, run, self.jobs)

    def test_selected_service_checks_allow_only_deliberately_skipped_unrelated_jobs(self):
        checks = ["homelab.operations", "homelab.darwin"]
        jobs = copy.deepcopy(self.jobs)
        jobs[2]["conclusion"] = "skipped"
        jobs.append({"name": "Homelab / Homelab CLI", "status": "completed", "conclusion": "skipped"})
        d.validate_ci(self.intent, self.run, jobs, checks=checks)
        for index, result in [(1, "skipped"), (2, "failure"), (3, "failure"), (5, "success")]:
            changed = copy.deepcopy(jobs)
            changed[index]["conclusion"] = result
            with self.assertRaises(ValueError):
                d.validate_ci(self.intent, self.run, changed, checks=checks)
        with self.assertRaises(ValueError):
            d.validate_ci(self.intent, self.run, jobs, checks=["homelab.operations"])

    def test_manual_reconciliation_requires_explicit_manual_permission(self):
        self.run["event"] = "workflow_dispatch"
        with self.assertRaises(ValueError):
            d.validate_ci(self.intent, self.run, self.jobs)
        d.validate_ci(self.intent, self.run, self.jobs, allow_manual=True)
        self.run["event"] = "pull_request"
        with self.assertRaises(ValueError):
            d.validate_ci(self.intent, self.run, self.jobs, allow_manual=True)

    def test_unrelated_app_source_exits_without_promotion_or_host_check_failure(self):
        event = {"workflow_run": {"head_sha": "a" * 40, "id": 42, "run_attempt": 3}}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "event.json"
            path.write_text(json.dumps(event))

            def download(*args):
                target = Path(args[args.index("--dir") + 1]) / "ci-selection.json"
                target.write_text(json.dumps({"head": "a" * 40, "event": "push", "delivery_candidates": []}))
                return ""

            with (
                patch.dict(
                    os.environ,
                    {
                        "GITHUB_REPOSITORY": d.REPOSITORY,
                        "GITHUB_EVENT_NAME": "workflow_run",
                        "GITHUB_EVENT_PATH": str(path),
                    },
                ),
                patch.object(d, "Store") as store,
                patch.object(d, "gh", side_effect=download),
                patch.object(
                    d, "load_selection", return_value={"head": "a" * 40, "event": "push", "delivery_candidates": []}
                ),
                patch.object(d, "source_configuration", return_value={}),
                patch.object(d.inputs, "input_hash", return_value="b" * 64),
                patch.object(d, "promote") as publish,
                patch.object(d, "api") as api,
            ):
                d.main()
                publish.assert_not_called()
                api.assert_not_called()
                store.return_value.commit.assert_not_called()

    def test_historical_or_retargeted_authority_cannot_be_promoted(self):
        def api(path):
            return {"jobs": self.jobs} if "/jobs?" in path else self.run

        for manifest in [
            {"schema": 2},
            {"schema": 3, "deployment": {"repository": "example/old", "branch": "deploy/homelab"}},
            {"schema": 3, "deployment": {"repository": d.REPOSITORY, "branch": "main"}},
        ]:
            with patch.object(d, "api", side_effect=api), patch.object(d, "source_manifest", return_value=manifest):
                with self.assertRaises(ValueError):
                    d.verify(self.intent)

    def test_changed_host_inputs_cannot_reuse_ci_intent(self):
        def api(path):
            return {"jobs": self.jobs} if "/jobs?" in path else self.run

        with (
            patch.object(d, "api", side_effect=api),
            patch.object(d, "source_configuration", return_value={}),
            patch.object(d.inputs, "input_hash", return_value="c" * 64),
        ):
            with self.assertRaises(ValueError):
                d.verify(self.intent)

    def test_unselected_or_wrong_source_artifact_cannot_authorize_promotion(self):
        def api(path):
            return {"jobs": self.jobs} if "/jobs?" in path else self.run

        for selection in [
            {"head": "a" * 40, "event": "push", "delivery_candidates": []},
            {"head": "c" * 40, "event": "push", "delivery_candidates": ["homelab.config"]},
            {"head": "a" * 40, "event": "pull_request", "delivery_candidates": ["homelab.config"]},
        ]:
            with patch.object(d, "api", side_effect=api):
                with self.assertRaises(ValueError):
                    d.verify(self.intent, selection)


if __name__ == "__main__":
    unittest.main()
