import subprocess
import sys
import unittest
from pathlib import Path


class DeveloperCommandTests(unittest.TestCase):
    def test_default_command_runs_fixture_and_transaction_tests_without_nix(self):
        root = Path(__file__).resolve().parents[2]
        result = subprocess.run(
            [sys.executable, "scripts/homelab/dev_check.py"], cwd=root, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("PASS planner, activation", result.stdout)
        self.assertEqual(len(result.stdout.splitlines()), 1)

    def test_unknown_area_is_rejected(self):
        root = Path(__file__).resolve().parents[2]
        result = subprocess.run(
            [sys.executable, "scripts/homelab/dev_check.py", "production"], cwd=root, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 2)
