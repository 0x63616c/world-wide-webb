"""Exercise readiness failures through the real image-check entry point."""

import json
import unittest
from contextlib import ExitStack
from unittest.mock import MagicMock, patch

import test_container as check


class ContainerReadinessTests(unittest.TestCase):
    def run_image_check(self, responses, clock=None):
        with ExitStack() as stack:
            stack.enter_context(patch.object(check, "docker", side_effect=["revision", "container", "127.0.0.1:1234"]))
            cleanup = stack.enter_context(patch.object(check.subprocess, "run"))
            stack.enter_context(patch.object(check.time, "sleep"))
            if clock:
                stack.enter_context(patch.object(check.time, "monotonic", side_effect=clock))
            request = stack.enter_context(patch.object(check.urllib.request, "urlopen", side_effect=responses))
            try:
                check.main("image", "revision")
            finally:
                self.assertEqual(cleanup.call_args.args[0], ["docker", "rm", "-f", "container"])
                self.requests = request.call_count

    @staticmethod
    def health(build="revision"):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(
            {"build": build, "cycles": {"enabled": False}}
        ).encode()
        return response

    def test_connection_reset_during_startup_is_retried(self):
        with self.assertRaisesRegex(ValueError, "application check reached"):
            self.run_image_check(
                [ConnectionResetError("startup"), self.health(), ValueError("application check reached")]
            )
        self.assertEqual(self.requests, 3)

    def test_persistent_reset_still_times_out(self):
        with self.assertRaisesRegex(RuntimeError, "image did not become ready"):
            self.run_image_check([ConnectionResetError("startup")], clock=[0, 31])
        self.assertEqual(self.requests, 1)

    def test_wrong_revision_fails_without_retry(self):
        with self.assertRaises(AssertionError):
            self.run_image_check([self.health("wrong")])
        self.assertEqual(self.requests, 1)

    def test_connection_reset_after_ready_is_not_retried(self):
        with self.assertRaisesRegex(ConnectionResetError, "application request"):
            self.run_image_check([self.health(), ConnectionResetError("application request")])
        self.assertEqual(self.requests, 2)
