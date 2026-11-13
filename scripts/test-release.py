#!/usr/bin/env python3
"""Portable release regressions: inputs, Duo PNG export, and submission with a fake ASC."""

import importlib.util
import json
import os
from pathlib import Path
import shutil
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

    def test_phone_capture_passes_release_metadata_to_xcode(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scripts, binaries = root / "scripts", root / "bin"
            scripts.mkdir()
            binaries.mkdir()
            (root / "apps/tendr").mkdir(parents=True)
            (root / "apps/tendr/project.yml").write_text("fixture project spec\n")
            for name in ("capture-screenshots.sh", "boot-simulator.sh", "screenshot-build-settings.py"):
                shutil.copy2(ROOT / "scripts" / name, scripts / name)
            tool = binaries / "tool"
            tool.write_text("""#!/usr/bin/env python3
import json, os, pathlib, sys
name, args = pathlib.Path(sys.argv[0]).name, sys.argv[1:]
if name == "ruby":
    print({"project_path":"fixture project.xcodeproj", "scheme":"Fixture", "screenshot_test":"FixtureTests", "name":"Fixture"}[args[-1]])
elif name == "xcodegen":
    pathlib.Path(os.environ["PROJECT_GENERATED_RECORD"]).write_text(str(pathlib.Path.cwd()))
elif name == "xcrun" and args[:2] == ["simctl", "create"]:
    assert pathlib.Path(os.environ["PROJECT_GENERATED_RECORD"]).exists(), "Generate before boot"
    print("fixture-simulator")
elif name == "xcodebuild":
    pathlib.Path(os.environ["SCREENSHOT_BUILD_RECORD"]).write_text(json.dumps(args))
    sys.exit(42)
""")
            tool.chmod(0o755)
            for name in ("ruby", "xcrun", "xcodebuild", "xcodegen"):
                (binaries / name).symlink_to(tool)
            record = root / "build.json"
            environment = {
                key: value
                for key, value in os.environ.items()
                if key not in ("RELEASE_MANIFEST", "RELEASE_VERSION", "RELEASE_BUILD")
            }
            environment.update(
                PATH=f"{binaries}:{environment['PATH']}",
                RELEASE_VERSION="1.1.1",
                RELEASE_BUILD="1",
                SCREENSHOT_BUILD_RECORD=str(record),
                PROJECT_GENERATED_RECORD=str(root / "generated-project"),
            )
            result = subprocess.run(
                ["bash", str(scripts / "capture-screenshots.sh"), "tendr"],
                env=environment,
                capture_output=True,
                text=True,
                timeout=15,
            )
            self.assertEqual(result.returncode, 42, result.stdout + result.stderr)
            self.assertEqual((root / "generated-project").read_text(), str((root / "apps/tendr").resolve()))
            arguments = json.loads(record.read_text())
            self.assertIn("MARKETING_VERSION=1.1.1", arguments)
            self.assertIn("CURRENT_PROJECT_VERSION=1", arguments)
            self.assertIn("fixture project.xcodeproj", arguments)

    def test_phone_capture_recovers_shutdown_between_appearances(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scripts, binaries = root / "scripts", root / "bin"
            scripts.mkdir()
            binaries.mkdir()
            for name in ("capture-screenshots.sh", "boot-simulator.sh", "screenshot-build-settings.py"):
                shutil.copy2(ROOT / "scripts" / name, scripts / name)
            tool = binaries / "tool"
            tool.write_text("""#!/usr/bin/env python3
import json, os, pathlib, struct, sys
name, args = pathlib.Path(sys.argv[0]).name, sys.argv[1:]
state = pathlib.Path(os.environ["SIMULATOR_STATE"])
with open(os.environ["COMMAND_RECORD"], "a") as log:
    log.write(json.dumps([name, *args]) + "\\n")
if name == "ruby":
    print({"project_path":"fixture.xcodeproj", "scheme":"Fixture", "screenshot_test":"FixtureTests", "name":"Fixture"}[args[-1]])
elif name == "xcrun":
    command = args[1]
    if command == "create":
        state.write_text("Shutdown")
        print("owned-simulator")
    elif command == "boot":
        state.write_text("Booted")
    elif command in ("ui", "status_bar", "bootstatus"):
        if state.read_text() != "Booted":
            sys.exit("Unable to lookup in current state: Shutdown")
elif name == "xcodebuild" and args[0] == "test-without-building":
    assert state.read_text() == "Booted"
    output = pathlib.Path(os.environ["TEST_RUNNER_SCREENSHOT_DIR"])
    (output / "home.png").write_bytes(b"\\x89PNG\\r\\n\\x1a\\n" + b"\\x00" * 8 + struct.pack(">II", 1320, 2868))
    state.write_text("Shutdown")  # Reproduce the state observed after the hosted test session.
""")
            tool.chmod(0o755)
            for name in ("ruby", "xcrun", "xcodebuild"):
                (binaries / name).symlink_to(tool)
            environment = {
                key: value
                for key, value in os.environ.items()
                if key not in ("RELEASE_MANIFEST", "RELEASE_VERSION", "RELEASE_BUILD")
            }
            environment.update(
                PATH=f"{binaries}:{environment['PATH']}",
                SIMULATOR_STATE=str(root / "state"),
                COMMAND_RECORD=str(root / "commands"),
            )
            result = subprocess.run(
                ["bash", str(scripts / "capture-screenshots.sh"), "tendr"],
                env=environment,
                capture_output=True,
                text=True,
                timeout=15,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            for appearance in ("light", "dark"):
                self.assertTrue((root / "build/screenshots/tendr/raw" / appearance / "home.png").is_file())
            commands = [json.loads(line) for line in (root / "commands").read_text().splitlines()]
            self.assertEqual(sum(command[:3] == ["xcrun", "simctl", "create"] for command in commands), 1)
            builds = [command for command in commands if command[:2] == ["xcodebuild", "build-for-testing"]]
            self.assertEqual(len(builds), 1)
            sessions = [command for command in commands if command[:2] == ["xcodebuild", "test-without-building"]]
            self.assertEqual(len(sessions), 2)
            for session in sessions:
                index = session.index("-parallel-testing-enabled")
                self.assertEqual(session[index + 1], "NO")

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

    def test_duo_landscape_export(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            raw, output = root / "raw", root / "output"
            raw.mkdir()
            config = root / "screenshots.json"
            config.write_text(json.dumps({"duo_shots": [{"screen": "home", "appearance": "dark"}]}))
            (raw / "plan.json").write_text('{"mode":"fold"}')
            for pose, size in (("inner", (2853, 2007)), ("outer", (2034, 1398))):
                image = Image.new("RGB", size, (23, 23, 23))
                image.putpixel((1, 1), (240, 240, 240))
                image.save(raw / f"{pose}-dark-home.png")
            duo.stage(config, raw, output)
            files = list(output.glob("*.png"))
            self.assertEqual(len(files), 2)
            for path in files:
                with Image.open(path) as image:
                    self.assertGreater(image.width, image.height)
                    self.assertEqual(image.getpixel((1, 1)), (240, 240, 240))

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
            for image in (
                Image.new("RGB", (100, 100)),
                Image.new("RGBA", (2007, 2853), (0, 0, 0, 0)),
                Image.new("RGB", (2007, 2853)),
            ):
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
