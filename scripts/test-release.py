#!/usr/bin/env python3
"""Portable release regressions: screenshot build metadata, release target, and submission with a fake ASC."""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
settings_spec = importlib.util.spec_from_file_location(
    "screenshot_settings", ROOT / "scripts/screenshot-build-settings.py"
)
screenshot_settings = importlib.util.module_from_spec(settings_spec)
settings_spec.loader.exec_module(screenshot_settings)

FAKE_ASC = r"""
require "json"
require "ostruct"
module Spaceship
  module ConnectAPI
    def self.auth(**args); end
    def self.client; FakeASC.new; end
  end
end
class FakeASC
  def tunes_request_client; self; end
  def get(path, params = nil)
    data = case path
    when "v1/builds"
      raise "wrong build filter" unless params["filter[version]"] == "18" && params["filter[preReleaseVersion.version]"] == "1.1.0"
      ENV["NO_BUILD"] == "true" ? [] : ["19", "18"].map { |n| {"id" => "build-#{n}", "attributes" => {"version" => n, "processingState" => "VALID", "expired" => false}} }
    when /appStoreVersions$/
      [{"id" => "version-id", "attributes" => {"versionString" => "1.1.0", "appVersionState" => "PREPARE_FOR_SUBMISSION"}}]
    when "v1/reviewSubmissions"
      [{"id" => "submission-id", "attributes" => {"state" => ENV.fetch("SUBMISSION_STATE", "READY_FOR_REVIEW")}}]
    when /items$/ then []
    else raise "unexpected GET #{path}"
    end
    OpenStruct.new(body: {"data" => data})
  end
  def patch(path, body)
    record(path, body)
    OpenStruct.new(body: {"data" => {"attributes" => {"state" => "WAITING_FOR_REVIEW"}}})
  end
  def post(path, body)
    record(path, body)
    OpenStruct.new(body: {"data" => {"id" => "submission-id"}})
  end
  def record(path, body)
    File.open(ENV.fetch("MUTATIONS"), "a") { |f| f.puts JSON.generate([path, body]) }
  end
end
"""


class ReleaseTests(unittest.TestCase):
    def test_screenshot_build_metadata_matches_processed_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            manifest = Path(temporary) / "release.json"
            manifest.write_text(json.dumps({"app": "tendr", "version": "1.1.1", "build": "1", "sha": "release-source"}))
            environment = {
                "RELEASE_MANIFEST": str(manifest),
                "GITHUB_SHA": "release-source",
                "RELEASE_VERSION": "1.1.1",
            }
            self.assertEqual(
                screenshot_settings.build_settings("tendr", environment),
                ["MARKETING_VERSION=1.1.1", "CURRENT_PROJECT_VERSION=1"],
            )
            for override in (
                {"GITHUB_SHA": "other-source"},
                {"GITHUB_SHA": ""},
                {"RELEASE_VERSION": "1.1.0"},
                {"RELEASE_BUILD": "29"},
            ):
                with self.subTest(override=override), self.assertRaises(ValueError):
                    screenshot_settings.build_settings("tendr", {**environment, **override})
            with self.assertRaises(ValueError):
                screenshot_settings.build_settings("other-app", environment)
            for field in ("version", "build"):
                manifest.write_text(
                    json.dumps({"app": "tendr", "version": "1.1.1", "build": "1", "sha": "release-source", field: ""})
                )
                with self.subTest(field=field), self.assertRaises(ValueError):
                    screenshot_settings.build_settings(
                        "tendr", {"RELEASE_MANIFEST": str(manifest), "GITHUB_SHA": "release-source"}
                    )
        self.assertEqual(screenshot_settings.build_settings("tendr", {}), [])
        self.assertEqual(
            screenshot_settings.build_settings("tendr", {"RELEASE_VERSION": "1.2", "RELEASE_BUILD": "18"}),
            ["MARKETING_VERSION=1.2", "CURRENT_PROJECT_VERSION=18"],
        )
        for override in ({"RELEASE_VERSION": "1.1.1\nOTHER=1"}, {"RELEASE_BUILD": "0"}, {"RELEASE_BUILD": "latest"}):
            with self.subTest(override=override), self.assertRaises(ValueError):
                screenshot_settings.build_settings("tendr", override)

    def run_ruby(self, script, env, args=()):
        # No real Apple credentials are used, including when this runs on a release Mac.
        base = {key: value for key, value in os.environ.items() if key != "GITHUB_OUTPUT"}
        return subprocess.run(
            ["ruby", str(ROOT / "scripts" / script), *args],
            cwd=ROOT,
            env={**base, **env},
            text=True,
            capture_output=True,
        )

    def test_release_target(self):
        result = self.run_ruby(
            "release-target.rb",
            {"GITHUB_REF_TYPE": "branch", "INPUT_APP": "tendr", "INPUT_VERSION": "1.1.0", "INPUT_BUILD": "18"},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("build=18", result.stdout)
        for tag, app in (
            ("app-store/tendr/1.1.0-18", "tendr"),
            ("app-store/tendr/1.2-9", "tendr"),
            ("app-store/1.0.0-28", "tendr"),
        ):
            result = self.run_ruby("release-target.rb", {"GITHUB_REF_TYPE": "tag", "GITHUB_REF_NAME": tag})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(f"app={app}\n", result.stdout)
        for tag in (
            "app-store/tendr/latest",
            "app-store/tendr/1.1.0",
            "app-store/unknown/1.1.0-18",
            "app-store/tendr/1.1.0-18/extra",
        ):
            result = self.run_ruby("release-target.rb", {"GITHUB_REF_TYPE": "tag", "GITHUB_REF_NAME": tag})
            self.assertNotEqual(result.returncode, 0, tag)
        for build in ("", "0", "latest", "18\napp=samplr", "18;echo nope"):
            result = self.run_ruby(
                "release-target.rb", {"GITHUB_REF_TYPE": "branch", "INPUT_APP": "tendr", "INPUT_BUILD": build}
            )
            self.assertNotEqual(result.returncode, 0, build)

    def test_submission_pins_build_and_dry_run_is_read_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "spaceship.rb").write_text(FAKE_ASC)
            mutations = root / "mutations.jsonl"
            env = {
                "RUBYLIB": tmp,
                "MUTATIONS": str(mutations),
                "ASC_KEY_ID": "fake",
                "ASC_ISSUER_ID": "fake",
                "ASC_KEY_CONTENT": "fake",
                "VERSION": "1.1.0",
                "BUILD_NUMBER": "18",
                "WHATS_NEW": "",
                "CANCEL_WAITING": "false",
            }
            for override in (
                {"DRY_RUN": "true"},
                {"BUILD_NUMBER": ""},
                {"NO_BUILD": "true"},
                {"SUBMISSION_STATE": "WAITING_FOR_REVIEW"},
            ):
                result = self.run_ruby("submit-review.rb", {**env, **override}, ["tendr"])
                self.assertEqual(result.returncode, 0 if override.get("DRY_RUN") == "true" else 1, result.stderr)
                self.assertFalse(mutations.exists(), result.stdout)
            result = self.run_ruby("submit-review.rb", {**env, "DRY_RUN": "false"}, ["tendr"])
            self.assertEqual(result.returncode, 0, result.stderr)
            calls = [json.loads(line) for line in mutations.read_text().splitlines()]
            build_call = next(body for path, body in calls if path.endswith("/relationships/build"))
            self.assertEqual(build_call["data"]["id"], "build-18")
            self.assertIn("build 18", result.stdout)
            release_call = next(
                body for path, body in calls if body.get("data", {}).get("attributes", {}).get("releaseType")
            )
            self.assertEqual(release_call["data"]["attributes"]["releaseType"], "AFTER_APPROVAL")


if __name__ == "__main__":
    unittest.main()
