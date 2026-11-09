"""Exercise the workflow's real shell without a network or provider credentials."""

import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


class CloudflareTransportTests(unittest.TestCase):
    def exercise(self, mode):
        root = Path(__file__).resolve().parents[3]
        workflow = (root / ".github/workflows/cloudflare.yml").read_text()
        marker = "      - name: Apply tested configuration on the state owner\n"
        block = workflow.split(marker, 1)[1].split("        run: |\n", 1)[1]
        script = textwrap.dedent(block)
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            fake = directory / "ssh"
            fake.write_text(
                f"#!{sys.executable}\n"
                + textwrap.dedent("""\
                import json, os, pathlib, stat, sys
                root = pathlib.Path(os.environ['RUNNER_TEMP'])
                for name in ('homelab-operations-key', 'homelab-operations-known-hosts'):
                    assert stat.S_IMODE((root / name).stat().st_mode) == 0o600
                with (root / 'commands.jsonl').open('a') as log:
                    log.write(json.dumps(sys.argv[1:]) + '\\n')
                command = sys.argv[-1]
                mode = os.environ['MODE']
                if command.startswith('mktemp '):
                    print('/unexpected/path' if mode == 'invalid-stage' else '/Users/admin/homelab-infra/candidate.fixture')
                elif command.startswith('python3 '):
                    if mode != 'missing-confirmation':
                        print('Applied tested Cloudflare configuration; encrypted recovery evidence retained')
                elif command.startswith('rm -rf '):
                    if mode == 'failed-cleanup':
                        sys.exit(1)
                else:
                    raise AssertionError('Unexpected remote operation')
                """)
            )
            fake.chmod(0o700)
            scp = directory / "scp"
            scp.write_text("#!/bin/sh\nexit 0\n")
            scp.chmod(0o700)
            result = subprocess.run(
                ["bash", "-c", script],
                cwd=root / "apps/control-center",
                env={
                    "PATH": temporary + os.pathsep + "/usr/bin:/bin",
                    "RUNNER_TEMP": temporary,
                    "SSH_KEY": "fixture-key",
                    "MINI_KNOWN_HOSTS": "fixture-public-pin",
                    "MODE": mode,
                },
                capture_output=True,
                text=True,
                check=False,
            )
            commands = [json.loads(line) for line in (directory / "commands.jsonl").read_text().splitlines()]
            self.assertFalse((directory / "homelab-operations-key").exists())
            self.assertFalse((directory / "homelab-operations-known-hosts").exists())
            for command in commands:
                self.assertIn("admin@homelab-mac-mini.tail8c014d.ts.net", command)
                for pin in (
                    "StrictHostKeyChecking=yes",
                    "IdentitiesOnly=yes",
                    "IdentityAgent=none",
                    "ForwardAgent=no",
                    "ControlMaster=no",
                    "ControlPath=none",
                ):
                    self.assertIn(pin, command)
            return result, commands

    def test_success_requires_confirmation_cleanup_and_private_pinned_transport(self):
        result, commands = self.exercise("success")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(commands), 3)
        self.assertTrue(commands[-1][-1].startswith("rm -rf "))

    def test_missing_confirmation_still_cleans_up_and_fails(self):
        result, commands = self.exercise("missing-confirmation")
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(commands[-1][-1].startswith("rm -rf "))

    def test_remote_cleanup_failure_is_not_delivery_success(self):
        result, _ = self.exercise("failed-cleanup")
        self.assertNotEqual(result.returncode, 0)

    def test_invalid_stage_never_gets_used_for_apply_or_recursive_deletion(self):
        result, commands = self.exercise("invalid-stage")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(commands), 1)


if __name__ == "__main__":
    unittest.main()
