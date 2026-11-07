#!/usr/bin/env python3
"""Portable release regressions: inputs, Duo PNG export, and submission with a fake ASC."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from PIL import Image

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("stage_duo", ROOT / "scripts/stage-duo-screenshots.py")
duo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(duo)

FAKE_ASC = r'''
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
'''


class ReleaseTests(unittest.TestCase):
    def run_ruby(self, script, env, args=()):
        # No real Apple credentials are used, including when this runs on a release Mac.
        base = {key: value for key, value in os.environ.items() if key != "GITHUB_OUTPUT"}
        return subprocess.run(["ruby", str(ROOT / "scripts" / script), *args],
                              cwd=ROOT, env={**base, **env}, text=True, capture_output=True)

    def test_release_target(self):
        result = self.run_ruby("release-target.rb", {"GITHUB_REF_TYPE": "branch", "INPUT_APP": "tendr", "INPUT_VERSION": "1.1.0", "INPUT_BUILD": "18"})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("build=18", result.stdout)
        for tag, app in (("app-store/tendr/1.1.0-18", "tendr"), ("app-store/tendr/1.2-9", "tendr"), ("app-store/1.0.0-28", "tendr")):
            result = self.run_ruby("release-target.rb", {"GITHUB_REF_TYPE": "tag", "GITHUB_REF_NAME": tag})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(f"app={app}\n", result.stdout)
        for tag in ("app-store/tendr/latest", "app-store/tendr/1.1.0", "app-store/unknown/1.1.0-18", "app-store/tendr/1.1.0-18/extra"):
            result = self.run_ruby("release-target.rb", {"GITHUB_REF_TYPE": "tag", "GITHUB_REF_NAME": tag})
            self.assertNotEqual(result.returncode, 0, tag)
        for build in ("", "0", "latest", "18\napp=samplr", "18;echo nope"):
            result = self.run_ruby("release-target.rb", {"GITHUB_REF_TYPE": "branch", "INPUT_APP": "tendr", "INPUT_BUILD": build})
            self.assertNotEqual(result.returncode, 0, build)

    def test_submission_pins_build_and_dry_run_is_read_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "spaceship.rb").write_text(FAKE_ASC)
            mutations = root / "mutations.jsonl"
            env = {"RUBYLIB": tmp, "MUTATIONS": str(mutations), "ASC_KEY_ID": "fake", "ASC_ISSUER_ID": "fake",
                   "ASC_KEY_CONTENT": "fake", "VERSION": "1.1.0", "BUILD_NUMBER": "18", "WHATS_NEW": "", "CANCEL_WAITING": "false"}
            for override in ({"DRY_RUN": "true"}, {"BUILD_NUMBER": ""}, {"NO_BUILD": "true"}, {"SUBMISSION_STATE": "WAITING_FOR_REVIEW"}):
                result = self.run_ruby("submit-review.rb", {**env, **override}, ["tendr"])
                self.assertEqual(result.returncode, 0 if override.get("DRY_RUN") == "true" else 1, result.stderr)
                self.assertFalse(mutations.exists(), result.stdout)
            result = self.run_ruby("submit-review.rb", {**env, "DRY_RUN": "false"}, ["tendr"])
            self.assertEqual(result.returncode, 0, result.stderr)
            calls = [json.loads(line) for line in mutations.read_text().splitlines()]
            build_call = next(body for path, body in calls if path.endswith("/relationships/build"))
            self.assertEqual(build_call["data"]["id"], "build-18")
            self.assertIn("build 18", result.stdout)
            release_call = next(body for path, body in calls if body.get("data", {}).get("attributes", {}).get("releaseType"))
            self.assertEqual(release_call["data"]["attributes"]["releaseType"], "AFTER_APPROVAL")

    def test_duo_export(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            raw, output = root / "raw", root / "output"
            raw.mkdir()
            output.mkdir()
            config = root / "screenshots.json"
            config.write_text(json.dumps({"duo_shots": [{"screen": "home", "appearance": "dark"}]}))
            (raw / "plan.json").write_text('{"mode":"fold"}')
            (output / "duo-stale.png").write_text("stale")
            ordinary = output / "01-home.png"
            ordinary.write_text("ordinary screenshot")
            for pose, size in (("inner", (2007, 2853)), ("outer", (1398, 2034))):
                image = Image.new("RGBA", size, (23, 23, 23, 255))
                image.putpixel((1, 1), (240, 240, 240, 255))
                image.save(raw / f"{pose}-dark-home.png")
            duo.stage(config, raw, output)
            files = list(output.glob("duo-*.png"))
            self.assertEqual(len(files), 2)
            self.assertTrue(ordinary.exists())
            for path in files:
                with Image.open(path) as image:
                    self.assertEqual(image.mode, "RGB")
                    self.assertEqual(image.getpixel((0, 0)), (23, 23, 23))
            before = {p.name: p.read_bytes() for p in output.iterdir()}
            for mode in ("default", "unknown"):
                (raw / "plan.json").write_text(json.dumps({"mode": mode}))
                with self.assertRaises(ValueError):
                    duo.stage(config, raw, output)
            (raw / "plan.json").write_text('{"mode":"displays"}')
            for image in (Image.new("RGB", (100, 100)), Image.new("RGBA", (2007, 2853), (0, 0, 0, 0)), Image.new("RGB", (2007, 2853))):
                image.save(raw / "inner-dark-home.png")
                with self.assertRaises(ValueError):
                    duo.stage(config, raw, output)
            (raw / "inner-dark-home.png").unlink()
            with self.assertRaises(FileNotFoundError):
                duo.stage(config, raw, output)
            config.write_text(json.dumps({"duo_shots": [{"screen": "home", "appearance": "dark"}] * 6}))
            with self.assertRaises(ValueError):
                duo.stage(config, raw, output)
            self.assertEqual(before, {p.name: p.read_bytes() for p in output.iterdir()})


if __name__ == "__main__":
    unittest.main()
