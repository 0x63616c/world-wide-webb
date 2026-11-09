import io
import json
import unittest
import zipfile

from ci_apple_receipt import parse_receipt, trusted


class AppleReceiptTests(unittest.TestCase):
    def test_receipt_is_bound_to_source_and_bounded_build_number(self):
        def archive(value):
            content = io.BytesIO()
            with zipfile.ZipFile(content, "w") as zipped:
                zipped.writestr("testflight-receipt.json", json.dumps(value))
            return content.getvalue()

        self.assertEqual(parse_receipt(archive({"sha": "a" * 40, "build": 123}), "a" * 40), 123)
        for value in [{"sha": "b" * 40, "build": 123}, {"sha": "a" * 40, "build": 0}, {"sha": "a" * 40, "build": True}]:
            with self.assertRaises(ValueError):
                parse_receipt(archive(value), "a" * 40)

    def test_fork_or_pr_workflows_cannot_forge_upload_evidence(self):
        run = dict(
            name="Apple Panel TestFlight",
            event="workflow_run",
            head_branch="main",
            head_repository={"full_name": "owner/repo"},
        )
        self.assertTrue(trusted(run, "owner/repo"))
        for patch in [
            {"event": "pull_request"},
            {"head_branch": "feature"},
            {"head_repository": {"full_name": "fork/repo"}},
        ]:
            self.assertFalse(trusted(dict(run, **patch), "owner/repo"))
