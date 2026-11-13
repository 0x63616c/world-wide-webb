"""Exercise the shared delivery interface without Apple or deployment credentials."""

import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import yaml

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("ios_delivery", ROOT / "scripts/ios_delivery.py")
delivery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delivery)


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.source = "a" * 40
        self.repo = "owner/repo"
        self.ci = dict(
            id=11,
            run_attempt=2,
            path=".github/workflows/ci.yml",
            head_sha=self.source,
            head_branch="main",
            event="push",
            status="completed",
            conclusion="success",
            head_repository={"full_name": self.repo},
        )

    def resolve_main(self, candidates, **selection):
        def download(*args):
            destination = Path(args[args.index("--dir") + 1])
            value = dict(head=self.source, event="push", delivery_candidates=candidates, **selection)
            (destination / "ci-selection.json").write_text(json.dumps(value))

        with patch.object(delivery, "gh", side_effect=download):
            return delivery.resolve("workflow_run", {"workflow_run": self.ci}, self.repo, "refs/heads/main", "other")

    def test_main_selection_keeps_products_and_backend_independent(self):
        for candidates, expected in [
            ([], (False, False, False)),
            (["tendr.native"], (True, False, False)),
            (["folding.native"], (False, True, False)),
            (["folding.backend"], (False, True, True)),
            (["callkeep.native", "homelab.config"], (False, False, False)),
        ]:
            result = self.resolve_main(candidates)
            self.assertEqual(tuple(result[key] for key in ("tendr", "folding", "backend")), expected)
            self.assertEqual(result["source"], self.source)
            self.assertEqual(result["ci_run_url"], f"https://github.com/{self.repo}/actions/runs/11/attempts/2")

    def test_untrusted_or_failed_ci_never_downloads_or_publishes(self):
        for key, value in [
            ("event", "pull_request"),
            ("head_branch", "feature"),
            ("conclusion", "failure"),
            ("head_sha", "other"),
            ("path", ".github/workflows/other.yml"),
            ("head_repository", {"full_name": "attacker/fork"}),
        ]:
            run = dict(self.ci, **{key: value})
            with self.subTest(key=key), self.assertRaises(ValueError):
                delivery.trusted_ci(run, self.source, self.repo)

    def test_receipt_must_name_the_exact_app_source_version_and_build(self):
        receipt = dict(app="tendr", sha=self.source, version="1.2.3", build="8")
        delivery.validate_receipt(receipt, "tendr", self.source, "1.2.3")
        for key, value in [("app", "folding"), ("sha", "other"), ("version", "1.2.4"), ("build", "latest")]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                delivery.validate_receipt(dict(receipt, **{key: value}), "tendr", self.source, "1.2.3")
        with self.assertRaises(ValueError):
            delivery.validate_receipt(dict(receipt, app="folding"), "folding", self.source, "1.2.3")

    def test_promotion_uses_a_successful_receipt_and_its_exact_ci_attempt(self):
        receipt = dict(app="tendr", sha=self.source, version="1.2.3", build="8", ci_run_id=11, ci_run_attempt=2)
        name = f"ios-beta-tendr-{self.source}"
        artifact = dict(id=9, name=name, expired=False, workflow_run={"id": 8})
        run = dict(
            path=".github/workflows/release.yml",
            event="workflow_run",
            status="completed",
            conclusion="success",
            head_repository={"full_name": self.repo},
        )

        def gh(*args):
            if args[:2] == ("run", "download"):
                (Path(args[args.index("--dir") + 1]) / "beta-receipt.json").write_text(json.dumps(receipt))
                return b""
            return json.dumps([{"artifacts": [artifact]}])

        producer = dict(name="Delivery / Tendr / publish", status="completed", conclusion="success")

        def api(path):
            if "/jobs?" in path:
                return {"jobs": [producer]}
            return self.ci if path.endswith("/attempts/2") else run

        with patch.object(delivery, "gh", side_effect=gh), patch.object(delivery, "api", side_effect=api):
            result, run_id, ci = delivery.beta_receipt(self.repo, "tendr", self.source, "1.2.3")
            self.assertEqual((result["build"], run_id, ci["run_attempt"]), ("8", 8, 2))
            run["conclusion"] = "failure"
            self.assertEqual(delivery.beta_receipt(self.repo, "tendr", self.source, "1.2.3")[0]["build"], "8")
            producer["conclusion"] = "failure"
            with self.assertRaisesRegex(ValueError, "No successful processed"):
                delivery.beta_receipt(self.repo, "tendr", self.source, "1.2.3")
            producer["conclusion"] = "success"
            run["event"] = "pull_request"
            with self.assertRaisesRegex(ValueError, "No successful processed"):
                delivery.beta_receipt(self.repo, "tendr", self.source, "1.2.3")

    def test_tag_selects_only_the_recorded_product_without_backend_deployment(self):
        with (
            patch.object(delivery, "tag_target", return_value=("folding", "1.2.3")),
            patch.object(delivery, "beta_receipt", return_value=({}, 8, self.ci)),
        ):
            result = delivery.resolve("push", {}, self.repo, "refs/tags/folding/v1.2.3", self.source)
        self.assertEqual(
            (result["tendr"], result["folding"], result["backend"], result["channel"]), (False, True, False, "store")
        )

    def test_annotated_tag_can_promote_an_older_main_commit_but_not_another_version_or_branch(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)

            def git(*args):
                return subprocess.check_output(["git", *args], cwd=repo, text=True).strip()

            git("init", "-q", "-b", "main")
            git("config", "user.name", "Fixture")
            git("config", "user.email", "fixture@example.invalid")
            git("config", "commit.gpgsign", "false")
            git("config", "tag.gpgsign", "false")
            (repo / "projects/tendr").mkdir(parents=True)
            (repo / "projects/tendr/app.yml").write_text("version: 1.2.3\n")
            git("add", ".")
            git("commit", "-qm", "App")
            source = git("rev-parse", "HEAD")
            git("-c", "tag.gpgsign=false", "tag", "-a", "tendr/v1.2.3", "-m", "Release")
            git("commit", "--allow-empty", "-qm", "Later main")
            git("remote", "add", "origin", str(repo))
            with patch.object(delivery, "ROOT", repo):
                self.assertEqual(delivery.tag_target("refs/tags/tendr/v1.2.3", source), ("tendr", "1.2.3"))
                with self.assertRaises(ValueError):
                    delivery.tag_target("refs/tags/tendr/v1.2.3", git("rev-parse", "HEAD"))
                git("tag", "tendr/v1.2.4", source)
                with self.assertRaisesRegex(ValueError, "app.yml version"):
                    delivery.tag_target("refs/tags/tendr/v1.2.4", source)

    def test_ruby_dependency_caches_do_not_dirty_release_source_but_source_edits_do(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)

            def git(*args):
                return subprocess.check_output(
                    ["git", "-c", "core.excludesFile=/dev/null", *args], cwd=repo, text=True
                ).strip()

            git("init", "-q", "-b", "main")
            git("config", "user.name", "Fixture")
            git("config", "user.email", "fixture@example.invalid")
            git("config", "commit.gpgsign", "false")
            (repo / ".gitignore").write_text((ROOT / ".gitignore").read_text())
            (repo / "App.swift").write_text("// source")
            git("add", ".")
            git("commit", "-qm", "Fixture")
            for filename in (".bundle/config", "vendor/bundle/cache/fixture.gem"):
                path = repo / filename
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("synthetic dependency cache")
            self.assertEqual(git("status", "--porcelain"), "")
            (repo / "App.swift").write_text("// changed source")
            self.assertIn("App.swift", git("status", "--porcelain"))

    def test_signing_access_exports_only_the_required_vault_field(self):
        import contextlib
        import os
        import runpy

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "environment"
            with (
                patch.dict(
                    os.environ,
                    {
                        "MATCH_GIT_BASIC_AUTHORIZATION": "synthetic-auth",
                        "OTHER_VAULT_FIELD": "synthetic-other",
                        "GITHUB_ENV": str(output),
                    },
                ),
                contextlib.redirect_stdout(io.StringIO()) as logs,
            ):
                runpy.run_path(str(ROOT / "scripts/match_access.py"), run_name="__main__")
            self.assertIn("MATCH_GIT_BASIC_AUTHORIZATION<<", output.read_text())
            self.assertNotIn("synthetic-other", output.read_text())
            self.assertEqual(logs.getvalue(), "::add-mask::synthetic-auth\n")

    def test_workflow_contract_has_one_event_owner_and_serializes_each_app_across_channels(self):
        def workflow(name):
            return yaml.safe_load((ROOT / ".github/workflows" / name).read_text())

        coordinator = workflow("testflight.yml")
        self.assertEqual(set(coordinator["on"]), {"workflow_call"})
        self.assertEqual(coordinator["jobs"]["verify"]["runs-on"], "ubuntu-24.04-arm")
        for app, filename in [("tendr", "tendr-delivery.yml"), ("folding", "folding-release.yml")]:
            child = workflow(filename)
            self.assertEqual(set(child["on"]), {"workflow_call"})
            job = child["jobs"]["publish"]
            self.assertEqual(job["concurrency"], {"group": f"app-store-{app}", "cancel-in-progress": False})
            steps = job["steps"]
            binary = [
                step
                for step in steps
                if "build_app" in step.get("run", "")
                or "ios beta " in step.get("run", "")
                or "ios continuous_beta " in step.get("run", "")
                or "signing" in step.get("name", "").lower()
            ]
            self.assertTrue(binary)
            self.assertTrue(all("inputs.channel == 'beta'" in step.get("if", "") for step in binary))
            self.assertNotIn("DELIVERY_ENABLED", json.dumps(child))


if __name__ == "__main__":
    unittest.main()
