import importlib.util
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("lan", Path(__file__).parents[1] / "scripts/wait-for-lan.py")
lan = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lan)


class LANStartupTests(unittest.TestCase):
    def test_cold_boot_waits_for_link_and_ipv4_before_bridge_start(self):
        states = iter([("inactive", ""), ("active", ""), ("active", "192.168.50.20")])
        current = None
        samples = []

        def run(command, **kwargs):
            nonlocal current
            if command[0] == "/sbin/ifconfig":
                current = next(states)
                samples.append(current)
                return subprocess.CompletedProcess(command, 0, "status: " + current[0] + "\n")
            self.assertEqual(command, ["/usr/sbin/ipconfig", "getifaddr", "en1"])
            return subprocess.CompletedProcess(command, 0 if current[1] else 1, current[1])

        with patch.object(subprocess, "run", side_effect=run), patch("time.sleep") as sleep:
            self.assertEqual(lan.wait_for_lan("en1"), "192.168.50.20")
        self.assertEqual(len(samples), 3)
        self.assertEqual(sleep.call_count, 2)

    def test_link_local_fallback_does_not_count_as_usable_lan(self):
        def run(command, **kwargs):
            output = "status: active" if command[0] == "/sbin/ifconfig" else "169.254.12.34"
            return subprocess.CompletedProcess(command, 0, output)

        with patch.object(lan.subprocess, "run", side_effect=run):
            self.assertIsNone(lan.lan_address("en1"))

    def test_timeout_fails_instead_of_starting_disconnected_bridge(self):
        with (
            patch.object(lan, "lan_address", return_value=None),
            patch.object(lan.time, "monotonic", side_effect=[0, 120]),
            patch.object(lan.time, "sleep") as sleep,
        ):
            with self.assertRaisesRegex(RuntimeError, "Physical LAN en1"):
                lan.wait_for_lan("en1")
            sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main()
