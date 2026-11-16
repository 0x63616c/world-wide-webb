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
    def test_tendr_publication_inputs_do_not_ship_folding(self):
        for path in ["projects/tendr/site/index.html", "projects/tendr/site.wrangler.jsonc", "scripts/publish-site.sh"]:
            result = selection.select([path], CONFIG)
            self.assertIn("sites.pages", result["verify"])
            self.assertEqual(result["delivery_candidates"], ["sites.pages"])
        result = selection.select(["scripts/test-publish-site.py"], CONFIG)
        self.assertIn("sites.pages", result["verify"])
        self.assertEqual(result["delivery_candidates"], [])
        result = selection.select(["projects/folding/site/index.html"], CONFIG)
        self.assertNotIn("sites.pages", result["verify"])

    def test_retired_app_deletions_do_not_select_unrelated_products(self):
        result = selection.select(["projects/airmiles/app.yml", "projects/airmiles/App/AirMilesApp.swift"], CONFIG)
        for key in ("verify", "checks", "previews", "delivery_candidates", "unmapped"):
            self.assertEqual(result[key], [])
        self.assertNotIn("airmiles.native", CONFIG["units"])
        mixed = selection.select(
            ["projects/airmiles/app.yml", "projects/folding/apps/ios/App/FoldingScreens.swift"], CONFIG
        )
        self.assertEqual(mixed["verify"], ["folding.native"])
        self.assertEqual(mixed["delivery_candidates"], ["folding.native"])

    def test_safari_extension_isolated_from_apps_and_homelab_delivery(self):
        for path in ["projects/golink-safari/Extension/redirect.js", ".github/workflows/golink-safari-ci.yml"]:
            with self.subTest(path=path):
                result = selection.select([path], CONFIG)
                self.assertEqual(result["verify"], ["golink.safari"])
                self.assertEqual(result["delivery_candidates"], [])
                self.assertEqual(result["unmapped"], [])

    def test_test_only_changes_verify_their_product_without_delivery(self):
        paths = [
            "projects/tendr/Tests/ImportTests.swift",
            "projects/folding/apps/ios/Packages/FoldingKit/Tests/SyncTests.swift",
            "projects/folding/backend/crates/worker/tests/runtime.rs",
            "projects/callkeep/Tests/RecorderTests.swift",
            "projects/control-center/server/tests/health.rs",
            "infra/cloudflare/home/tests/routing.tftest.hcl",
        ]
        for path in paths:
            with self.subTest(path=path):
                result = selection.select([path], CONFIG)
                self.assertTrue(result["verify"])
                self.assertEqual(result["delivery_candidates"], [])

    def test_distribution_tooling_only_releases_the_changed_product_publisher(self):
        result = selection.select(["scripts/distribution/homelab.py"], CONFIG)
        self.assertEqual(result["verify"], ["callkeep.native", "homelab.cli", "homelab.config"])
        self.assertEqual(result["delivery_candidates"], ["homelab.cli"])
        result = selection.select(["projects/homelab/cli/README.md"], CONFIG)
        self.assertEqual(result["delivery_candidates"], [])

    def test_folding_store_capture_inputs_keep_a_source_bound_beta(self):
        for path in [
            "projects/folding/apps/ios/Screenshots/FoldingScreenshotApp.swift",
            "projects/folding/apps/ios/StorefrontTests/StorefrontCaptureTests.swift",
            "projects/folding/fastlane/screenshot-plan.json",
            "projects/folding/fastlane/lib/release_assets.rb",
            "projects/folding/fastlane/scripts/opaque-screen.swift",
        ]:
            with self.subTest(path=path):
                result = selection.select([path], CONFIG)
                self.assertEqual(result["verify"], ["folding.native"])
                self.assertEqual(result["delivery_candidates"], ["folding.native"])

    def test_native_change_only_releases_its_product(self):
        result = selection.select(["projects/folding/apps/ios/App/FoldingScreens.swift"], CONFIG)
        self.assertEqual(result["verify"], ["folding.native"])
        self.assertEqual(result["delivery_candidates"], ["folding.native"])

    def test_contracts_verify_clients_without_unproven_delivery(self):
        result = selection.select(["projects/folding/contracts/api.json"], CONFIG)
        self.assertEqual(result["verify"], ["folding.backend", "folding.contracts", "folding.native"])
        self.assertEqual(result["delivery_candidates"], [])

    def test_worker_embedded_resources_are_delivery_inputs(self):
        for suffix in ["templates/admin.html", "policies/names-v1.json", "roots/apple.der", "build.rs"]:
            result = selection.select(["projects/folding/backend/crates/worker/" + suffix], CONFIG)
            self.assertEqual(result["delivery_candidates"], ["folding.backend"])

    def test_tooling_verifies_but_does_not_ship(self):
        result = selection.select([".github/workflows/ci.yml"], CONFIG)
        self.assertEqual(result["verify"], ["repo.tooling"])
        self.assertEqual(result["delivery_candidates"], [])
        for path, owner in [
            ("mise.lock", "repo.tooling"),
            ("mise.toml", "repo.tooling"),
        ]:
            with self.subTest(path=path):
                result = selection.select([path], CONFIG)
                self.assertIn(owner, result["verify"])
                self.assertEqual(result["delivery_candidates"], [])

    def test_moved_project_paths_select_new_owner_without_unknown_legacy_paths(self):
        result = selection.select(
            [
                "apps/tendr/Still/App.swift",
                "projects/tendr/Still/App.swift",
                "homelab/flake.nix",
                "projects/homelab/flake.nix",
            ],
            CONFIG,
        )
        self.assertEqual(result["unmapped"], [])
        self.assertIn("tendr.native", result["verify"])
        self.assertIn("homelab.config", result["verify"])

    def test_docs_do_not_activate_hosts_or_ship_apps(self):
        result = selection.select(
            ["README.md", "projects/homelab/docs/current-state.md", ".agents/skills/new/SKILL.md"], CONFIG
        )
        self.assertEqual(result["verify"], [])
        self.assertEqual(result["delivery_candidates"], [])

    def test_listing_markdown_is_not_treated_as_documentation(self):
        result = selection.select(["projects/tendr/fastlane/metadata/review.md"], CONFIG)
        self.assertEqual(result["delivery_candidates"], ["tendr.native"])

    def test_cli_change_verifies_host_without_activating_it(self):
        result = selection.select(["projects/homelab/cli/src/lib.rs"], CONFIG)
        self.assertEqual(result["verify"], ["homelab.cli", "homelab.config"])
        self.assertEqual(result["delivery_candidates"], ["homelab.cli"])

    def test_root_flake_bridge_selects_host_promotion(self):
        result = selection.select(["flake.nix", "flake.lock"], CONFIG)
        self.assertEqual(result["verify"], ["homelab.config"])
        self.assertEqual(result["delivery_candidates"], ["homelab.config"])

    def test_host_automation_and_app_pin_have_separate_delivery_authority(self):
        tooling = selection.select(["scripts/homelab/promote_control_center.py"], CONFIG)
        self.assertEqual(tooling["verify"], ["homelab.config"])
        self.assertEqual(tooling["delivery_candidates"], [])
        pin = selection.select(["projects/homelab/services/control-center/release.json"], CONFIG)
        self.assertEqual(pin["verify"], ["homelab.config"])
        self.assertEqual(pin["delivery_candidates"], ["homelab.config"])

    def test_product_credentials_cannot_activate_hosts_or_ship_apps(self):
        result = selection.select(["secrets/vault.yaml"], CONFIG)
        self.assertEqual(set(result["verify"]), {"credentials.home", "control-center.server", "cloudflare.home"})
        self.assertEqual(result["delivery_candidates"], [])
        self.assertEqual(selection.select([".sops.yaml"], CONFIG)["delivery_candidates"], [])
        host = selection.select(["projects/homelab/secrets/homelab-mac-mini.sops.yaml"], CONFIG)
        self.assertEqual(host["verify"], ["homelab.config"])
        self.assertEqual(host["delivery_candidates"], ["homelab.config"])

    def test_unknown_path_requires_verification_without_shipping(self):
        result = selection.select(["new-root-tool.toml"], CONFIG)
        self.assertEqual(result["verify"], [])
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
            (repo / "projects/tendr/Still").mkdir(parents=True)
            (repo / "projects/tendr/Still/old.swift").write_text("let a = 1\n")
            git("add", ".")
            git("commit", "-qm", "base")
            base = git("rev-parse", "HEAD")
            (repo / "projects/callkeep/Sources").mkdir(parents=True)
            (repo / "projects/tendr/Still/old.swift").rename(repo / "projects/callkeep/Sources/new.swift")
            git("add", ".")
            git("commit", "-qm", "move")
            paths = selection.changed_paths(base, git("rev-parse", "HEAD"), "push", repo)
            result = selection.select(paths, CONFIG)
            self.assertEqual(result["delivery_candidates"], ["callkeep.native", "tendr.native"])


if __name__ == "__main__":
    unittest.main()
