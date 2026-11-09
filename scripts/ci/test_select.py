"""Product isolation and real Git comparison semantics."""

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("selection", Path(__file__).with_name("select_units.py"))
selection = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(selection)
CONFIG = json.loads(selection.CONFIG.read_text())


class SelectionTests(unittest.TestCase):
    def test_test_only_changes_verify_their_product_without_delivery(self):
        paths = ["apps/tendr/Tests/ImportTests.swift", "apps/folding/apps/ios/Packages/FoldingKit/Tests/SyncTests.swift",
                 "apps/folding/backend/crates/worker/tests/runtime.rs", "apps/callkeep/Tests/RecorderTests.swift",
                 "apps/control-center/server/tests/health.rs", "infra/cloudflare/home/tests/routing.tftest.hcl"]
        for path in paths:
            with self.subTest(path=path):
                result = selection.select([path], CONFIG)
                self.assertTrue(result["verify"])
                self.assertEqual(result["delivery_candidates"], [])

    def test_distribution_tooling_only_releases_the_changed_product_publisher(self):
        result = selection.select(["scripts/distribution/homelab.py"], CONFIG)
        self.assertEqual(result["verify"], ["callkeep.native", "homelab.cli", "homelab.config"])
        self.assertEqual(result["delivery_candidates"], ["homelab.cli"])
        result = selection.select(["homelab/cli/README.md"], CONFIG)
        self.assertEqual(result["delivery_candidates"], [])

    def test_native_change_only_releases_its_product(self):
        result = selection.select(["apps/folding/apps/ios/App/FoldingScreens.swift"], CONFIG)
        self.assertEqual(result["verify"], ["folding.native"])
        self.assertEqual(result["delivery_candidates"], ["folding.native"])

    def test_contracts_verify_clients_without_unproven_delivery(self):
        result = selection.select(["apps/folding/contracts/api.json"], CONFIG)
        self.assertEqual(result["verify"], ["folding.backend", "folding.contracts", "folding.native"])
        self.assertEqual(result["delivery_candidates"], [])

    def test_worker_embedded_resources_are_delivery_inputs(self):
        for suffix in ["templates/admin.html", "policies/names-v1.json", "roots/apple.der", "build.rs"]:
            result = selection.select(["apps/folding/backend/crates/worker/" + suffix], CONFIG)
            self.assertEqual(result["delivery_candidates"], ["folding.backend"])

    def test_tooling_verifies_but_does_not_ship(self):
        result = selection.select([".github/workflows/ci.yml"], CONFIG)
        self.assertEqual(set(result["verify"]), set(CONFIG["units"]))
        self.assertEqual(result["delivery_candidates"], [])

    def test_docs_do_not_activate_hosts_or_ship_apps(self):
        result = selection.select(["README.md", "homelab/docs/current-state.md", ".agents/skills/new/SKILL.md"], CONFIG)
        self.assertEqual(result["verify"], [])
        self.assertEqual(result["delivery_candidates"], [])

    def test_listing_markdown_is_not_treated_as_documentation(self):
        result = selection.select(["apps/tendr/fastlane/metadata/review.md"], CONFIG)
        self.assertEqual(result["delivery_candidates"], ["tendr.native"])

    def test_cli_change_verifies_host_without_activating_it(self):
        result = selection.select(["homelab/cli/src/lib.rs"], CONFIG)
        self.assertEqual(result["verify"], ["homelab.cli", "homelab.config"])
        self.assertEqual(result["delivery_candidates"], ["homelab.cli"])

    def test_host_automation_and_app_pin_have_separate_delivery_authority(self):
        tooling = selection.select(["scripts/homelab/promote_control_center.py"], CONFIG)
        self.assertEqual(tooling["verify"], ["homelab.config"])
        self.assertEqual(tooling["delivery_candidates"], [])
        pin = selection.select(["homelab/services/control-center/release.json"], CONFIG)
        self.assertEqual(pin["verify"], ["homelab.config"])
        self.assertEqual(pin["delivery_candidates"], ["homelab.config"])

    def test_product_credentials_cannot_activate_hosts_or_ship_apps(self):
        result = selection.select(["secrets/vault.yaml"], CONFIG)
        self.assertEqual(set(result["verify"]), {"credentials.home", "control-center.server", "cloudflare.home"})
        self.assertEqual(result["delivery_candidates"], [])
        self.assertEqual(selection.select([".sops.yaml"], CONFIG)["delivery_candidates"], [])
        host = selection.select(["secrets/homelab-mac-mini.sops.yaml"], CONFIG)
        self.assertEqual(host["verify"], ["homelab.config"])
        self.assertEqual(host["delivery_candidates"], ["homelab.config"])

    def test_unknown_path_requires_verification_without_shipping(self):
        result = selection.select(["new-root-tool.toml"], CONFIG)
        self.assertEqual(set(result["verify"]), set(CONFIG["units"]))
        self.assertEqual(result["unmapped"], ["new-root-tool.toml"])
        self.assertEqual(result["delivery_candidates"], [])

    def test_force_is_verification_only(self):
        result = selection.select([], CONFIG, force=True)
        self.assertEqual(set(result["verify"]), set(CONFIG["units"]))
        self.assertEqual(result["delivery_candidates"], [])

    def test_deleted_and_renamed_paths_keep_both_owners(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)

            def git(*args):
                return subprocess.check_output(["git", *args], cwd=repo, text=True).strip()

            git("init", "-q")
            git("config", "user.name", "Test")
            git("config", "user.email", "test@example.invalid")
            (repo / "apps/tendr/Still").mkdir(parents=True)
            (repo / "apps/tendr/Still/old.swift").write_text("let a = 1\n")
            git("add", ".")
            git("commit", "-qm", "base")
            base = git("rev-parse", "HEAD")
            (repo / "apps/callkeep/Sources").mkdir(parents=True)
            (repo / "apps/tendr/Still/old.swift").rename(repo / "apps/callkeep/Sources/new.swift")
            git("add", ".")
            git("commit", "-qm", "move")
            paths = selection.changed_paths(base, git("rev-parse", "HEAD"), "push", repo)
            result = selection.select(paths, CONFIG)
            self.assertEqual(result["delivery_candidates"], ["callkeep.native", "tendr.native"])


if __name__ == "__main__":
    unittest.main()
