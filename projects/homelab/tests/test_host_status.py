import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("host_status", Path(__file__).parents[1] / "scripts" / "host-status.py")
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)


class HostStatusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_redaction_strips_query_strings_and_credentials(self):
        line = (
            "GET /api/v1/state?token=abc&x=1 200 Authorization: Bearer eyJhbGciOi.x.y "
            'password=hunter2 {"access_token": "s3cret"} ok'
        )
        redacted = host.redact(line)
        for secret in ("abc", "eyJhbGciOi", "hunter2", "s3cret"):
            self.assertNotIn(secret, redacted)
        self.assertIn("GET /api/v1/state?[redacted] 200", redacted)
        self.assertTrue(redacted.endswith(" ok"))
        self.assertEqual(host.redact("plain error: boom"), "plain error: boom")

    def test_deploy_check_reports_only_stopped_updates(self):
        ops = self.root / "ops"
        ops.mkdir()
        self.assertEqual(host.deploy_check(ops), {"state": "ok"})
        (ops / "transaction").write_text(json.dumps({"phase": "backup"}))
        self.assertEqual(host.deploy_check(ops), {"state": "ok"}, "a running update is not blocked")
        (ops / "transaction").write_text(json.dumps({"phase": "backup", "failedAt": "2026-11-17T01:00:00+00:00"}))
        self.assertEqual(
            host.deploy_check(ops),
            {"state": "blocked", "since": "2026-11-17T01:00:00+00:00", "reason": "The backup step failed"},
        )
        (ops / "transaction").unlink()
        (ops / "last-preflight.json").write_text(json.dumps({"accepted": False, "startedAt": "t"}))
        self.assertEqual(host.deploy_check(ops)["reason"], "Downloading the new version failed")

    def test_nas_check_passes_publisher_state_through(self):
        self.assertEqual(host.nas_check(self.root), {"state": "unknown"})
        nas = {"state": "failing", "since": "t", "reason": "The Mini can’t reach the NAS"}
        (self.root / "publication-status.json").write_text(json.dumps({"format": 1, "nas": nas}))
        self.assertEqual(host.nas_check(self.root), nas)

    def test_container_logs_skip_hindsight_and_use_safe_names(self):
        calls = []

        def run(command, **kwargs):
            calls.append(command)
            if command[1] == "ps":
                return subprocess.CompletedProcess(command, 0, "www-control-center-www-1\nhindsight-api-1\n")
            return subprocess.CompletedProcess(command, 0, "a\nb\n")

        logs = host.container_logs("docker", "/sock", run=run)
        self.assertEqual(logs, {"www-control-center-www-1": ["a", "b"]})
        self.assertFalse(any("hindsight-api-1" in command for command in calls))

    def test_export_writes_redacted_tails_and_drops_removed_sources(self):
        out = self.root / "out"
        (out / "logs").mkdir(parents=True)
        (out / "logs" / "gone.log").write_text("old\n")
        status = {"format": 1, "nas": {"state": "ok"}, "deploy": {"state": "ok"}}
        host.export(out, status, {"deploy": ["token=abc", "done"]})
        self.assertEqual((out / "logs" / "deploy.log").read_text(), "token=[redacted]\ndone\n")
        self.assertFalse((out / "logs" / "gone.log").exists())
        self.assertEqual(json.loads((out / "status.json").read_text()), status)
        self.assertEqual((out / "status.json").stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
