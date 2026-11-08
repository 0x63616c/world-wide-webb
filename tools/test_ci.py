import os
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

from ci_changes import classify
from ci_gate import verify


class CITests(unittest.TestCase):
    def test_cloudflare_apply_requires_positive_remote_confirmation(self):
        workflow = Path(__file__).resolve().parents[1] / ".github/workflows/cloudflare.yml"
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
        needs["changes"]["outputs"] = dict(apple="true", image="true", infra="false")
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
