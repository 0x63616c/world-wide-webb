"""Actual check selection must isolate tests, platforms and workflow consumers."""

import json
import unittest
from pathlib import Path

from select_units import select

CONFIG = json.loads(Path(__file__).with_name("units.json").read_text())


class CheckSelectionTests(unittest.TestCase):
    def checks(self, *paths):
        return set(select(paths, CONFIG)["checks"])

    def test_homelab_test_and_service_changes_do_not_test_the_linux_controller(self):
        self.assertEqual(self.checks("projects/homelab/tests/test_backup.py"), {"homelab.operations"})
        self.assertEqual(
            self.checks("projects/homelab/services/control-center/release.json"),
            {"homelab.operations", "homelab.darwin"},
        )
        self.assertEqual(self.checks("projects/homelab/runner/src/main.rs"), {"homelab.linux", "homelab.darwin"})
        self.assertEqual(self.checks("projects/homelab/runner/tests/test.rs"), {"homelab.linux"})

    def test_cli_and_shared_process_keep_real_host_consumers(self):
        self.assertEqual(self.checks("projects/homelab/cli/src/tui.rs"), {"homelab.cli", "homelab.darwin"})
        self.assertEqual(self.checks("projects/homelab/cli/tests/config.rs"), {"homelab.cli"})
        self.assertEqual(
            self.checks("projects/homelab/process/src/lib.rs"), {"homelab.cli", "homelab.darwin", "homelab.host"}
        )

    def test_image_helpers_run_their_actual_python_consumers(self):
        self.assertIn("homelab.operations", self.checks("projects/homelab/runner/images/linux/build-image.py"))
        self.assertIn("homelab.operations", self.checks("projects/homelab/runner/images/linux/cache-image.py"))

    def test_process_test_lock_is_not_a_host_delivery_input(self):
        result = select(["projects/homelab/process/Cargo.lock"], CONFIG)
        self.assertEqual(result["delivery_candidates"], [])
        self.assertIn("homelab.cli", result["checks"])

    def test_host_tests_run_without_a_nix_build(self):
        self.assertEqual(self.checks("projects/homelab/host/tests/health.rs"), {"homelab.host"})

    def test_native_ui_avoids_rust_and_server_tests_avoid_simulator_and_image(self):
        self.assertEqual(self.checks("projects/control-center/apple/App/Clock.swift"), {"control-center.apple"})
        self.assertEqual(
            self.checks("projects/control-center/server/tests/api.rs"),
            {"control-center.rust", "control-center.contract"},
        )
        self.assertEqual(
            self.checks("projects/control-center/server/src/http.rs"),
            {"control-center.rust", "control-center.contract", "control-center.image"},
        )

    def test_workflow_consumers_are_verified_without_delivery(self):
        result = select([".github/workflows/homelab-ci.yml"], CONFIG)
        self.assertEqual(result["verify"], ["homelab.cli", "homelab.config"])
        self.assertEqual(
            set(result["checks"]),
            {"homelab.operations", "homelab.linux", "homelab.darwin", "homelab.host", "homelab.cli"},
        )
        self.assertEqual(result["delivery_candidates"], [])
        self.assertTrue(result["check_reasons"]["homelab.darwin"])

    def test_shared_tooling_stays_cheap_and_force_is_explicit(self):
        result = select(["scripts/ci/select_units.py"], CONFIG)
        self.assertEqual(result["verify"], ["repo.tooling"])
        self.assertEqual(result["checks"], [])
        forced = select([], CONFIG, force=True)
        self.assertEqual(set(forced["checks"]), set(CONFIG["checks"]))
        self.assertEqual(forced["delivery_candidates"], [])

    def test_mixed_changes_union_checks_and_do_not_hide_safety_inputs(self):
        result = self.checks(
            "projects/homelab/tests/test_backup.py",
            "projects/homelab/modules/operations.nix",
            "projects/homelab/runner/src/main.rs",
        )
        self.assertEqual(result, {"homelab.operations", "homelab.linux", "homelab.darwin"})


if __name__ == "__main__":
    unittest.main()
