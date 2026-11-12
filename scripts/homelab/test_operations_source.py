import copy
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
SPEC = importlib.util.spec_from_file_location("operations_source", Path(__file__).with_name("operations_source.py"))
source = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(source)


class OperationsSourceTests(unittest.TestCase):
    def fixture(self):
        run = {
            "id": 12,
            "run_attempt": 2,
            "head_sha": "a" * 40,
            "head_branch": "main",
            "head_repository": {"full_name": "0x63616c/world-wide-webb"},
            "path": ".github/workflows/ci.yml",
            "event": "push",
            "status": "completed",
            "conclusion": "success",
        }
        jobs = [
            {"name": name, "status": "completed", "conclusion": "success"}
            for name in (
                "Homelab / Homelab selection",
                "Homelab / Homelab operations",
                "Homelab / Homelab Linux controller",
                "Homelab / Homelab Darwin configuration",
                "Homelab / Homelab checks",
            )
        ]
        return run, jobs

    def check(self, run, jobs):
        with (
            patch.object(source, "api", side_effect=lambda path: {"jobs": jobs} if "/jobs?" in path else run),
            patch.object(source.inputs, "input_hash", return_value="b" * 64),
        ):
            return source.checked("12", "a" * 40)

    def test_checks_exact_canary_code_and_named_host_ci_before_staging(self):
        run, jobs = self.fixture()
        self.assertEqual(self.check(run, jobs), "a" * 40)
        manual = dict(run, event="workflow_dispatch")
        self.assertEqual(self.check(manual, jobs), "a" * 40)
        for field, value in [
            ("head_sha", "c" * 40),
            ("head_branch", "feature"),
            ("path", ".github/workflows/folding-ci.yml"),
            ("event", "pull_request"),
            ("conclusion", "failure"),
        ]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.check(dict(run, **{field: value}), jobs)
        changed = copy.deepcopy(jobs)
        changed[2]["conclusion"] = "skipped"
        with self.assertRaises(ValueError):
            self.check(run, changed)


if __name__ == "__main__":
    unittest.main()
