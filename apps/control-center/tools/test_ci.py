import os
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

from ci_changes import classify, classify_repository
from ci_gate import verify


class CITests(unittest.TestCase):
    def test_cloudflare_apply_requires_positive_remote_confirmation(self):
        workflow = Path(__file__).resolve().parents[3] / ".github/workflows/cloudflare.yml"
        source = workflow.read_text()
        confirmation = textwrap.dedent(source[source.index("          result=$(ssh") :])
        expected = "Applied tested Cloudflare configuration; encrypted recovery evidence retained"
        with tempfile.TemporaryDirectory() as directory:
            ssh = Path(directory) / "ssh"
            ssh.write_text('#!/bin/sh\nprintf "%s" "$REMOTE_OUTPUT"\nexit "$REMOTE_STATUS"\n')
            ssh.chmod(0o700)
            for output, status, succeeds in [(expected, 0, True), ("", 0, False), (expected, 1, False)]:
                result = subprocess.run(
                    ["bash", "-c", "set -euo pipefail\noptions=(-T)\nremote=fixture\nstage=/fixture\n" + confirmation],
                    env={
                        "PATH": directory + os.pathsep + "/usr/bin:/bin",
                        "REMOTE_OUTPUT": output,
                        "REMOTE_STATUS": str(status),
                    },
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertEqual(result.returncode == 0, succeeds)

    def test_selection_tracks_contract_and_deployment_dependencies(self):
        self.assertEqual(classify(["README.md"]), dict(apple=False, image=False, infra=False, publish_apple=False))
        self.assertEqual(
            classify(["server/src/features/lights.rs"]), dict(apple=True, image=True, infra=False, publish_apple=False)
        )
        self.assertEqual(
            classify(["apple/App/HomeView.swift"]), dict(apple=True, image=False, infra=False, publish_apple=True)
        )
        self.assertEqual(
            classify(["deploy/mini/compose.yaml"]), dict(apple=False, image=True, infra=False, publish_apple=False)
        )
        self.assertEqual(
            classify(["infra/cloudflare/main.tf"]), dict(apple=False, image=False, infra=True, publish_apple=False)
        )
        for path in [".github/workflows/ci.yml"]:
            selected = classify([path])
            self.assertTrue(all(selected[k] for k in ["apple", "image", "infra"]))
            self.assertFalse(selected["publish_apple"])
        self.assertTrue(classify([".swift-format"])["apple"])
        self.assertTrue(all(classify([], True).values()))

    def test_cloudflare_deployment_changes_only_select_infrastructure(self):
        paths = [".github/workflows/cloudflare.yml", "tools/infra_apply.py", "infra/cloudflare/main.tf"]
        expected = dict(apple=False, image=False, infra=True, publish_apple=False)
        for path in paths:
            self.assertEqual(classify([path]), expected, path)
        self.assertEqual(classify(paths + ["tools/ci_changes.py", "tools/test_ci.py"]), expected)
        self.assertEqual(
            classify(paths + ["server/src/main.rs"]),
            dict(apple=True, image=True, infra=True, publish_apple=False),
        )
        self.assertTrue(all(classify(paths, True).values()))

    def test_native_publication_tracks_shipping_inputs_without_republishing_backend_or_tests(self):
        for path in [
            "apple/Resources/icon.png",
            "apple/Extensions/NextAlarmWidget/Widget.swift",
            "apple/Packages/PanelKit/Sources/PanelKit/ClimateAPI.swift",
            "apple/VERSION",
            "apple/Packages/PanelKit/Package.swift",
            "apple/Packages/PanelKit/Package.resolved",
            "apple/project.yml",
            "apple/fastlane/Fastfile",
            "tools/ci_signing_env.py",
        ]:
            self.assertTrue(classify([path])["publish_apple"], path)
        for path in [
            "apple/Tests/Unit/ClockTests.swift",
            "apple/Packages/PanelKit/Tests/PanelKitTests/ClimateTests.swift",
            "apple/docs/history.md",
            ".github/workflows/apple-panel-testflight.yml",
            "server/src/main.rs",
        ]:
            self.assertFalse(classify([path])["publish_apple"], path)
            self.assertTrue(classify([path])["apple"], path)

    def test_gate_rejects_missing_failed_cancelled_and_unexpectedly_skipped_checks(self):
        needs = {k: {"result": "success"} for k in ["changes", "typecheck", "test-unit", "apple", "image", "infra"]}
        needs["changes"]["outputs"] = dict(apple="true", image="true", infra="false", checks="true")
        needs["infra"]["result"] = "skipped"
        verify(needs)
        for job in ["changes", "typecheck", "test-unit", "apple", "image", "infra"]:
            original = needs[job]["result"]
            for result in ["failure", "cancelled", "missing"] + ([] if job == "infra" else ["skipped"]):
                needs[job]["result"] = result
                with self.assertRaises(ValueError):
                    verify(needs)
            needs[job]["result"] = original
        needs["changes"]["outputs"].pop("apple")
        with self.assertRaises(ValueError):
            verify(needs)

    def test_penpot_infrastructure_does_not_rebuild_or_deploy_the_native_app(self):
        paths = [
            "deploy/penpot/compose.yaml",
            "deploy/mini/penpot_backup.py",
            "deploy/mini/penpot_provision.py",
            "deploy/mini/test_penpot_backup.py",
            "infra/cloudflare/main.tf",
            "tools/ci_changes.py",
            "tools/test_ci.py",
        ]
        self.assertEqual(classify(paths), dict(apple=False, image=False, publish_apple=False, infra=True))
        self.assertEqual(
            classify(paths + ["server/src/runtime.rs"]), dict(apple=True, image=True, publish_apple=False, infra=True)
        )
        self.assertEqual(
            classify(paths + ["deploy/mini/release.sh"]), dict(apple=False, image=True, publish_apple=False, infra=True)
        )
        self.assertEqual(
            classify(paths + ["apple/App/HomeView.swift"]),
            dict(apple=True, image=False, publish_apple=True, infra=True),
        )
        self.assertTrue(all(classify(paths, True).values()))


class RepositorySelectionTests(unittest.TestCase):
    def test_unrelated_app_does_not_run_control_center(self):
        self.assertFalse(any(classify_repository(["apps/tendr/Still/Store.swift"]).values()))

    def test_product_native_keeps_existing_publication_policy(self):
        selected = classify_repository(["apps/control-center/apple/App/Clock.swift"])
        self.assertTrue(selected["checks"])
        self.assertTrue(selected["publish_apple"])
        self.assertFalse(selected["image"])

    def test_docs_can_skip_every_product_job(self):
        needs = {key: {"result": "skipped"} for key in ["typecheck", "test-unit", "apple", "image", "infra"]}
        needs["changes"] = {
            "result": "success",
            "outputs": dict(checks="false", apple="false", image="false", infra="false"),
        }
        verify(needs)
        needs["test-unit"]["result"] = "failure"
        with self.assertRaises(ValueError):
            verify(needs)

    def test_force_verifies_without_publishing(self):
        selected = classify_repository([], True)
        self.assertTrue(selected["checks"])
        self.assertTrue(selected["apple"])
        self.assertTrue(selected["infra"])
        self.assertFalse(selected["publish_apple"])


class InfrastructureIsolationTests(unittest.TestCase):
    def test_home_hcl_verifies_infrastructure_without_building_products(self):
        self.assertEqual(
            classify_repository(["infra/cloudflare/home/main.tf"]),
            dict(
                apple=False,
                image=False,
                infra=True,
                checks=False,
                publish_apple=False,
                publish_image=False,
                apply_infra=True,
            ),
        )

    def test_folding_hcl_does_not_select_control_center(self):
        self.assertFalse(any(classify_repository(["infra/cloudflare/folding/production/main.tf"]).values()))


class DeliveryAuthorityTests(unittest.TestCase):
    def test_shared_and_unmapped_verification_never_publish_or_apply(self):
        for path in ["fastlane/Fastfile", "Gemfile", ".github/workflows/ci.yml", "unmapped-config.json"]:
            selected = classify_repository([path])
            self.assertTrue(selected["image"])
            self.assertTrue(selected["infra"])
            self.assertFalse(selected["publish_image"], path)
            self.assertFalse(selected["apply_infra"], path)

    def test_application_image_and_infra_have_independent_publish_inputs(self):
        server = classify_repository(["apps/control-center/server/src/main.rs"])
        self.assertTrue(server["publish_image"])
        self.assertFalse(server["apply_infra"])
        helper = classify_repository(["apps/control-center/tools/infra_apply.py"])
        self.assertTrue(helper["infra"])
        self.assertTrue(helper["apply_infra"])
        self.assertFalse(helper["checks"])
        self.assertFalse(helper["publish_image"])

    def test_native_and_test_changes_do_not_publish_the_server(self):
        for path in ["apps/control-center/apple/App/Clock.swift", "apps/control-center/server/tests/http.rs"]:
            self.assertFalse(classify_repository([path])["publish_image"])
