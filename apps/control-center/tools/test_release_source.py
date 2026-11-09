import unittest

from ci_release_source import verify


class ReleaseSourceTests(unittest.TestCase):
    def test_only_successful_main_pushes_from_this_repository_can_release(self):
        run = dict(
            name="CI",
            path=".github/workflows/ci.yml",
            status="completed",
            conclusion="success",
            event="push",
            head_branch="main",
            head_repository={"full_name": "owner/repo"},
            head_sha="a" * 40,
            run_number=42,
            id=123,
            run_attempt=2,
        )
        self.assertEqual(verify(run, "owner/repo"), dict(sha="a" * 40, generation=42, run_id=123, attempt=2))
        for key, value in [
            ("conclusion", "failure"),
            ("conclusion", "cancelled"),
            ("status", "in_progress"),
            ("path", ".github/workflows/other.yml"),
            ("path", None),
            ("event", "pull_request"),
            ("head_branch", "feature"),
            ("head_sha", "invalid"),
            ("run_number", 0),
            ("run_number", True),
            ("run_attempt", 0),
            ("run_attempt", None),
            ("id", False),
            ("head_repository", {"full_name": "fork/repo"}),
        ]:
            with self.assertRaises(ValueError):
                verify(dict(run, **{key: value}), "owner/repo")
