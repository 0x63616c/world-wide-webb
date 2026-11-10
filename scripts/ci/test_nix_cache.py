"""Cache failures cannot stand in for verification or cause unbounded work."""

import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import nix_cache


class NixCacheTests(unittest.TestCase):
    def test_closure_budget_counts_all_paths_for_both_nix_json_formats(self):
        self.assertEqual(nix_cache.closure_size([{"narSize": 2}, {"narSize": 3}]), 5)
        self.assertEqual(nix_cache.closure_size({"a": {"narSize": 2}, "b": {"narSize": 3}}), 5)

    def test_missing_and_unsigned_exports_are_not_ready(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            root = Path(directory)
            self.assertEqual(nix_cache.transfer("restore", root, root / "roots")["status"], "miss")
            self.assertEqual(nix_cache.transfer("export", root, root / "roots")["status"], "no-signing-key")

    def test_oversized_closure_never_signs_or_copies(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            roots = root / "roots.json"
            roots.write_text(json.dumps(["/nix/store/fixture"]))
            with (
                patch.dict(os.environ, NIX_CI_CACHE_SIGNING_KEY="synthetic-fixture"),
                patch.object(
                    nix_cache, "command", return_value=json.dumps([{"narSize": nix_cache.MAX_BYTES + 1}])
                ) as command,
            ):
                result = nix_cache.transfer("export", root / "cache", roots)
            self.assertEqual(result["status"], "over-size-budget")
            self.assertEqual(command.call_count, 1)

    def test_restore_requires_signatures_and_failure_is_visible(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "nix-cache-info").touch()
            with patch.object(nix_cache, "command", side_effect=subprocess.TimeoutExpired("nix", 1)) as command:
                result = nix_cache.transfer("restore", root, root / "roots")
            self.assertEqual(result["status"], "unavailable")
            args = command.call_args.args[0]
            self.assertIn("--extra-trusted-public-keys", args)
            self.assertNotIn("--no-check-sigs", args)
            self.assertNotIn("trusted=1", " ".join(args))

    def test_real_client_timeout_is_bounded(self):
        started = time.monotonic()
        with self.assertRaises(subprocess.TimeoutExpired):
            nix_cache.command([sys.executable, "-c", "import time; time.sleep(20)"], started + 0.05)
        self.assertLess(time.monotonic() - started, 2)


if __name__ == "__main__":
    unittest.main()
