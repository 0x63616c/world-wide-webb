import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import check_nix
from check_nix import service_only


class NixScopeTests(unittest.TestCase):
    def test_service_only_builds_hosts_while_shared_inputs_keep_full_checks(self):
        self.assertTrue(service_only(["projects/homelab/services/beszel/config.yml"]))
        for paths in [
            [],
            ["projects/homelab/modules/operations.nix"],
            ["projects/homelab/services/beszel/config.yml", "projects/homelab/flake.lock"],
            ["projects/homelab/cli/src/lib.rs"],
        ]:
            self.assertFalse(service_only(paths))

    def test_cache_roots_exclude_whole_system_without_narrowing_builds(self):
        outputs = {
            name: "/nix/store/" + name
            for name in [
                "management-client",
                "host-operations",
                "runner-controller",
                "mac-mini",
                "macbook",
                "deployment-inputs",
            ]
        }
        for service in [False, True]:
            with self.subTest(service=service), tempfile.TemporaryDirectory() as directory:
                roots = Path(directory) / "roots.json"
                argv = ["check_nix", "--roots-output", str(roots)]
                replies = [json.dumps(outputs)]
                if service:
                    argv += ["--base", "a" * 40, "--head", "b" * 40]
                    replies.insert(0, "projects/homelab/services/example/release.json\0")
                with (
                    patch("sys.argv", argv),
                    patch.object(check_nix.subprocess, "run") as run,
                    patch.object(check_nix.subprocess, "check_output", side_effect=replies),
                ):
                    check_nix.main()
                expected = [outputs["management-client"], outputs["host-operations"]]
                if not service:
                    expected.append(outputs["runner-controller"])
                self.assertEqual(json.loads(roots.read_text()), sorted(expected))
                commands = [call.args[0] for call in run.call_args_list]
                self.assertEqual(commands[0][:3], ["nix", "flake", "check"])
                self.assertIn("projects/homelab", commands[0])
                if service:
                    self.assertIn("--no-build", commands[0])
                    self.assertIn("projects/homelab#checks.aarch64-darwin.mac-mini", commands[1])
                    self.assertIn("projects/homelab#checks.aarch64-darwin.macbook", commands[1])
                    self.assertIn("projects/homelab#checks.aarch64-darwin.deployment-inputs", commands[1])
                else:
                    self.assertNotIn("--no-build", commands[0])
                    self.assertEqual(len(commands), 1)
