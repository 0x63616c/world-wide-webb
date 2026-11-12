import importlib.util
import os
from pathlib import Path
import signal
import subprocess
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("child", Path(__file__).parents[1] / "scripts/service-child.py")
child = importlib.util.module_from_spec(spec)
spec.loader.exec_module(child)


class ServiceChildTests(unittest.TestCase):
    def setUp(self):
        self.account = Mock(pw_uid=450, pw_gid=450, pw_dir="/var/lib/_containers")
        for target, value in ((child.os, "geteuid"), (child.pwd, "getpwnam")):
            patcher = patch.object(target, value, return_value=0 if value == "geteuid" else self.account)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.object(Path, "resolve", return_value=Path("/nix/store/reviewed-system"))
        patcher.start()
        self.addCleanup(patcher.stop)
        patcher = patch.object(child.subprocess, "Popen")
        self.spawn = patcher.start()
        self.addCleanup(patcher.stop)
        self.spawn.return_value.wait.return_value = 0

    def test_child_drops_root_and_does_not_inherit_credentials(self):
        with patch.dict(os.environ, {"GITHUB_TOKEN": "test-secret", "SOPS_AGE_KEY": "test-key"}):
            child.run_service("reconcile", 7, 900)
        args, options = self.spawn.call_args
        self.assertEqual(args[0], ["/nix/store/reviewed-system/sw/bin/homelab-reconcile-all"])
        self.assertEqual((options["user"], options["group"], options["extra_groups"]), (450, 450, [450]))
        self.assertEqual(options["pass_fds"], (7,))
        self.assertEqual(options["env"]["HOMELAB_OPERATION_FD"], "7")
        self.assertNotIn("GITHUB_TOKEN", options["env"])
        self.assertNotIn("SOPS_AGE_KEY", options["env"])
        self.assertEqual(options["umask"], 0o077)

    def test_unknown_operation_never_spawns(self):
        with self.assertRaises(ValueError):
            child.run_service("/bin/sh", 7, 10)
        self.spawn.assert_not_called()

    def test_wrong_service_identity_never_spawns(self):
        self.account.pw_uid = 501
        with self.assertRaises(RuntimeError):
            child.run_service("backup", 7, 10)
        self.spawn.assert_not_called()

    @patch.object(child.os, "killpg")
    def test_timeout_terminates_whole_command_group(self, kill):
        process = self.spawn.return_value
        process.pid = 12345
        process.wait.side_effect = [subprocess.TimeoutExpired("backup", 10), 0]
        with self.assertRaises(subprocess.TimeoutExpired):
            child.run_service("backup", 7, 10)
        self.assertEqual([call.args for call in kill.call_args_list], [(12345, signal.SIGKILL)])

    def test_failure_is_not_reported_as_success(self):
        self.spawn.return_value.wait.return_value = 75
        with self.assertRaises(subprocess.CalledProcessError):
            child.run_service("health", 7, 10)


if __name__ == "__main__":
    unittest.main()
