import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "operations_canary", Path(__file__).parents[1] / "scripts/operations-canary.py"
)
canary = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(canary)


class OperationsCanaryTests(unittest.TestCase):
    def test_remote_staging_program_roundtrips_metadata_and_removes_its_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            payload = json.dumps({"schema": 1, "source": "a" * 40}).encode()
            completed = subprocess.run(
                [sys.executable, "-c", canary.REMOTE],
                input=payload,
                capture_output=True,
                check=True,
                env=dict(os.environ, TMPDIR=temporary),
            )
            value = json.loads(completed.stdout)
            self.assertEqual(
                value,
                {"source": "a" * 40, "sha256": hashlib.sha256(payload).hexdigest(), "staged": True, "cleaned": True},
            )
            self.assertEqual(list(Path(temporary).iterdir()), [])

    def probe(self, peer_open=False, altered=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ("homelab-operations-key", "homelab-operations-known-hosts"):
                path = root / name
                path.touch(mode=0o600)
            result = io.StringIO()
            real_run = subprocess.run

            class Connection:
                def __enter__(self):
                    return self

                def __exit__(self, *_):
                    return False

                def settimeout(self, _):
                    pass

                def connect_ex(self, _):
                    return 0 if peer_open else 60

            def ssh(args, **kwargs):
                self.assertEqual(args[0], "ssh")
                self.assertIn("admin@" + canary.TARGET, args)
                for option in (
                    "StrictHostKeyChecking=yes",
                    "IdentitiesOnly=yes",
                    "IdentityAgent=none",
                    "ForwardAgent=no",
                    "ControlMaster=no",
                    "ControlPath=none",
                ):
                    self.assertIn(option, args)
                executed = real_run(
                    [sys.executable, "-c", canary.REMOTE], input=kwargs["input"], capture_output=True, check=True
                )
                if altered:
                    value = json.loads(executed.stdout)
                    value["cleaned"] = False
                    executed.stdout = json.dumps(value).encode()
                return executed

            with (
                patch.dict(os.environ, RUNNER_TEMP=str(root), SOURCE_SHA="a" * 40),
                patch.object(
                    canary.socket,
                    "getaddrinfo",
                    return_value=[(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("100.100.100.100", 22))],
                ),
                patch.object(canary.socket, "socket", return_value=Connection()),
                patch.object(canary.subprocess, "run", side_effect=ssh) as transport,
                contextlib.redirect_stdout(result),
            ):
                if peer_open or altered:
                    with self.assertRaises(ValueError):
                        canary.main()
                    if peer_open:
                        transport.assert_not_called()
                else:
                    canary.main()
                    self.assertTrue(json.loads(result.getvalue())["other_peer_ssh_unreachable"])

    def test_exact_pinned_transport_and_staging_evidence_are_required(self):
        self.probe()
        self.probe(altered=True)

    def test_unapproved_peer_access_stops_before_any_ssh_operation(self):
        self.probe(peer_open=True)


if __name__ == "__main__":
    unittest.main()
