#!/usr/bin/env python3
"""Portable tests for capability probing, fallback and the full capture script handshake."""
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("duo_simulator", ROOT / "scripts/duo-simulator.py")
duo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(duo)
xcode_spec = importlib.util.spec_from_file_location("select_duo_xcode", ROOT / "scripts/select-duo-xcode.py")
xcode = importlib.util.module_from_spec(xcode_spec)
xcode_spec.loader.exec_module(xcode)

MOCK_TOOL = r'''#!/usr/bin/env python3
import base64, json, os, pathlib, sys, time
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
mode = os.environ["MOCK_DUO_MODE"]
if name == "ruby":
    print({"project_path":"apps/tendr/Still.xcodeproj", "scheme":"Still", "duo_screenshot_test":"StillUITests/DuoScreenshotTests", "name":"Tendr"}[args[-1]])
elif name == "xcrun":
    args = args[1:]
    with open(os.environ["MOCK_SIMCTL_LOG"], "a") as log:
        log.write(json.dumps(args) + "\n")
    if args[:2] == ["list", "devicetypes"]:
        print(json.dumps({"devicetypes": [] if mode == "missing" else [{"name":"iPhone Duo", "identifier":"mock.duo"}]}))
    elif args[:2] == ["list", "runtimes"]:
        print(json.dumps({"runtimes":[{"platform":"iOS", "isAvailable":True,"version":"27.1","identifier":"com.apple.CoreSimulator.SimRuntime.iOS-27-1"}]}))
    elif args[:2] == ["list", "devices"]:
        print(os.environ["MOCK_SIMULATORS"])
    elif args == ["shutdown", "stale-shutdown"]:
        sys.exit("Device is already shut down")
    elif args[0] == "create":
        pathlib.Path(os.environ["MOCK_CREATED_DEVICE"]).write_text(args[2])
        print("mock-udid")
    elif args[0] == "help":
        if mode in ("fold", "rejected") and args[-1] == "fold":
            print("fold <device> <state>: folded or unfolded")
        elif mode == "displays" and args[-1] == "io":
            print("screenshot --display=<id>")
        else:
            print("No fold or named display support")
    elif args[0] == "fold" and mode == "rejected":
        sys.exit(1)
    elif args[0] == "io" and args[2] == "enumerate":
        print("Display 0: Inner\nDisplay 1: Outer" if mode == "displays" else "Display 0: Main")
    elif args[0] == "io" and args[2] == "screenshot":
        pathlib.Path(args[-1]).write_bytes(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="))
elif name == "xcodebuild" and args[0] == "test-without-building":
    if mode == "test-failure": sys.exit("Mock test failure")
    folder = pathlib.Path(os.environ["TEST_RUNNER_DUO_CONTROL_DIR"])
    def request(action, value):
        identifier = str(time.time_ns())
        temporary = folder / "test-request.tmp"
        temporary.write_text(json.dumps({"id":identifier,"action":action,"name":value}))
        temporary.replace(folder / "request.json")
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            response = folder / "response.json"
            if response.exists():
                result = json.loads(response.read_text())
                if result["id"] == identifier:
                    assert result["ok"], result
                    return
            time.sleep(0.02)
        sys.exit("Mock UI test timed out")
    poses = ["inner", "outer"] if os.environ["TEST_RUNNER_DUO_CAN_FOLD"] == "1" else ["default"]
    for pose in poses:
        if pose != "default": request("pose", pose)
        for screen in ["home","treatment","progress","journal","settings","log-dose","landscape-home","landscape-progress","landscape-log-dose"]:
            request("capture", screen)
'''


class XcodeSelectionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.applications = Path(self.temporary.name) / "Applications with spaces"
        self.applications.mkdir()

    def install(self, name, version, executable=True):
        app = self.applications / name
        developer = app / "Contents/Developer"
        binary = developer / "usr/bin/xcodebuild"
        binary.parent.mkdir(parents=True)
        binary.write_text("#!/bin/sh\nexit 0\n")
        binary.chmod(0o755 if executable else 0o644)
        with (app / "Contents/version.plist").open("wb") as file:
            plistlib.dump({"CFBundleShortVersionString": version}, file)
        return developer

    def test_explicit_usable_path_wins(self):
        requested = self.install("Xcode custom.app", "27.2")
        self.install("Xcode-27.1.app", "27.1")
        self.assertEqual(xcode.select_xcode(str(requested), self.applications), requested)

    def test_hyphenated_27_1_precedes_newest_fallback(self):
        expected = self.install("Xcode-27.1.app", "27.1")
        self.install("Xcode-27.0.app", "27.0")
        self.install("Xcode_28.0.app", "28.0")
        missing_request = self.applications / "Xcode_27.1.app/Contents/Developer"
        self.assertEqual(xcode.select_xcode(str(missing_request), self.applications), expected)

    def test_underscored_27_1_precedes_newest_fallback(self):
        expected = self.install("Xcode_27.1.app", "27.1")
        self.install("Xcode-28.0.app", "28.0")
        missing_request = self.applications / "Xcode-27.1.app/Contents/Developer"
        self.assertEqual(xcode.select_xcode(str(missing_request), self.applications), expected)

    def test_hosted_27_1_is_default_even_with_newer_rc_and_legacy_install(self):
        expected = self.install("Xcode_27.1.app", "27.1")
        self.install("Xcode-27.1.app", "27.1")
        self.install("Xcode_27.2_Release_Candidate.app", "27.2")
        self.assertEqual(xcode.select_xcode("", self.applications), expected)

    def test_newest_version_is_numeric_and_ignores_bundle_spelling(self):
        self.install("Xcode-27.9.app", "27.9")
        expected = self.install("Xcode.app", "27.10")
        self.install("Xcode_26.2.app", "26.2")
        self.assertEqual(xcode.select_xcode("/missing", self.applications), expected)

    def test_unusable_bundles_are_skipped(self):
        requested = self.install("Xcode-27.1.app", "27.1", executable=False)
        expected = self.install("Xcode_27.1.app", "27.1")
        self.assertEqual(xcode.select_xcode(str(requested), self.applications), expected)

    def test_missing_xcode_fails_clearly(self):
        with self.assertRaisesRegex(ValueError, "No usable .*Xcode.*install Xcode 27.1"):
            xcode.select_xcode("/missing", self.applications)


class SimctlTimeoutTests(unittest.TestCase):
    def test_default_and_configured_timeout(self):
        for value, expected in [(None, 180), ("240", 240), ("0.5", 0.5)]:
            with self.subTest(value=value), patch.dict(os.environ), patch.object(duo.subprocess, "run") as run:
                os.environ.pop("DUO_SIMCTL_TIMEOUT", None)
                if value is not None:
                    os.environ["DUO_SIMCTL_TIMEOUT"] = value
                duo.simctl("help", "io", check=True)
                run.assert_called_once_with(
                    ["xcrun", "simctl", "help", "io"], text=True,
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    timeout=expected, check=True)

    def test_read_only_probe_timeout_retries_once(self):
        for args in [("help",), ("help", "io"), ("help", "ui"), ("help", "fold"), ("list", "devices")]:
            with self.subTest(args=args), patch.object(duo.subprocess, "run") as run:
                result = subprocess.CompletedProcess(args, 0, stdout="capabilities")
                run.side_effect = [subprocess.TimeoutExpired(args, 180), result]
                self.assertIs(duo.simctl(*args), result)
                self.assertEqual(run.call_count, 2)
                self.assertEqual(run.call_args_list[0], run.call_args_list[1])

    def test_second_timeout_is_propagated(self):
        with patch.object(duo.subprocess, "run") as run:
            run.side_effect = subprocess.TimeoutExpired(["help"], 180)
            with self.assertRaises(subprocess.TimeoutExpired):
                duo.simctl("help")
            self.assertEqual(run.call_count, 2)

    def test_other_calls_and_non_timeout_failures_are_not_retried(self):
        for args, error in [
            (("fold", "test", "folded"), subprocess.TimeoutExpired(["fold"], 180)),
            (("io", "test", "screenshot"), subprocess.TimeoutExpired(["io"], 180)),
            (("help",), subprocess.CalledProcessError(1, ["help"])),
            (("list",), OSError("missing xcrun")),
        ]:
            with self.subTest(args=args, error=error), patch.object(duo.subprocess, "run") as run:
                run.side_effect = error
                with self.assertRaises(type(error)):
                    duo.simctl(*args, check=True)
                run.assert_called_once()

    def test_unsuccessful_help_result_is_returned_without_retry(self):
        with patch.object(duo.subprocess, "run") as run:
            result = subprocess.CompletedProcess(["help", "fold"], 1, stdout="unsupported")
            run.return_value = result
            self.assertIs(duo.simctl("help", "fold"), result)
            run.assert_called_once()


class DuoCapabilitiesTests(unittest.TestCase):
    def test_only_explicit_inner_and_outer_names_are_used(self):
        self.assertEqual(duo.named_displays("Display 0: Main\nDisplay 1: External"), {})
        self.assertEqual(duo.named_displays("Display 0: Inner"), {})
        self.assertEqual(duo.named_displays("Display 2: Inner\nDisplay 4: Outer"), {"inner":"2", "outer":"4"})
        self.assertEqual(duo.named_displays(json.dumps({"displays":[{"id":3,"name":"Inner display"},{"id":7,"name":"Outer display"}]})), {"inner":"3", "outer":"7"})

    def test_no_undocumented_fold_command_is_attempted(self):
        self.assertEqual(duo.fold_candidates("test", {}), [])
        self.assertEqual(duo.fold_candidates("test", {"ui":"appearance light dark"}), [])
        commands = duo.fold_candidates("test", {"ui":"fold <state>: folded unfolded"})
        self.assertEqual(commands, [{"outer":["ui","test","fold","folded"],"inner":["ui","test","fold","unfolded"]}])

    def capture(self, mode, override=None, devices=None):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scripts = root / "scripts"
            scripts.mkdir()
            for name in ["capture-duo-screenshots.sh", "duo-simulator.py", "boot-simulator.sh"]:
                shutil.copy2(ROOT / "scripts" / name, scripts / name)
            commands = root / "bin"
            commands.mkdir()
            tool = commands / "mock-tool"
            tool.write_text(MOCK_TOOL)
            tool.chmod(0o755)
            for name in ["ruby", "xcrun", "xcodebuild"]:
                (commands / name).symlink_to(tool)
            env = dict(os.environ, PATH=f"{commands}:{os.environ['PATH']}", MOCK_DUO_MODE=mode,
                       MOCK_CREATED_DEVICE=str(root / "created-device"),
                       MOCK_SIMCTL_LOG=str(root / "simctl.jsonl"),
                       MOCK_SIMULATORS=json.dumps({"devices": devices or {}}))
            env.pop("R_SIM_DEVICE_TYPE", None)
            env.pop("R_SIM_RUNTIME", None)
            if override:
                env["R_SIM_DEVICE_TYPE"] = override
            output = root / "output with spaces"
            output.mkdir()
            for pose in ["inner", "outer", "default"]:
                for appearance in ["light", "dark"]:
                    (output / f"{pose}-{appearance}-obsolete.png").write_bytes(b"stale")
            for filename in ["plan.json", "capture-notes.txt", "simctl-capabilities.txt"]:
                (output / filename).write_text("stale")
            (output / "keep.txt").write_text("unrelated user file")
            result = subprocess.run(["bash", str(scripts / "capture-duo-screenshots.sh"), "tendr", str(output)],
                                    text=True, capture_output=True, env=env, timeout=55)
            self.assertFalse(list(output.glob("*-obsolete.png")))
            self.assertEqual((output / "keep.txt").read_text(), "unrelated user file")
            if mode == "missing" and override is None:
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("No iPhone Duo simulator device type found", result.stderr)
                self.assertFalse((output / "plan.json").exists())
                return
            if mode == "test-failure":
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Mock test failure", result.stderr)
                self.assertFalse(list(output.glob("*.png")))
                return
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            plan = json.loads((output / "plan.json").read_text())
            expected_mode = mode if mode in ("fold", "displays") else "default"
            self.assertEqual(plan["mode"], expected_mode)
            poses = ["inner", "outer"] if expected_mode in ("fold", "displays") else ["default"]
            self.assertEqual(len(list(output.glob("*.png"))), len(poses) * 2 * 9)
            for pose in poses:
                for appearance in ["light", "dark"]:
                    self.assertTrue((output / f"{pose}-{appearance}-home.png").is_file())
            self.assertEqual((root / "created-device").read_text(), override or "mock.duo")
            if expected_mode == "default":
                self.assertIn("default only", (output / "capture-notes.txt").read_text())
            return [json.loads(line) for line in (root / "simctl.jsonl").read_text().splitlines()]

    def test_stale_simulators_are_removed_before_creation_and_boot(self):
        commands = self.capture("default", devices={
            "com.apple.CoreSimulator.SimRuntime.iOS-27-1": [
                {"name": "Tendr Duo Screenshots", "udid": "stale-booted", "state": "Booted", "isAvailable": True},
                {"name": "Tendr Screenshots", "udid": "other-capture", "state": "Booted", "isAvailable": True},
                {"name": "Personal Tendr Duo Screenshots", "udid": "personal", "state": "Booted", "isAvailable": True},
                {"name": "Blockr Duo Screenshots", "udid": "other-app", "state": "Booted", "isAvailable": True},
            ],
            "mock.ios26": [
                {"name": "Tendr Duo Screenshots old-run", "udid": "stale-shutdown", "state": "Shutdown", "isAvailable": False},
            ],
        })
        lifecycle = [command for command in commands if command[0] in ("shutdown", "delete", "create", "boot")]
        self.assertEqual(lifecycle, [
            ["shutdown", "stale-booted"],
            ["delete", "stale-booted"],
            ["shutdown", "stale-shutdown"],
            ["delete", "stale-shutdown"],
            ["create", "Tendr Duo Screenshots", "mock.duo", "com.apple.CoreSimulator.SimRuntime.iOS-27-1"],
            ["boot", "mock-udid"],
            ["shutdown", "mock-udid"],
            ["delete", "mock-udid"],
        ])

    def test_fold_capture(self): self.capture("fold")
    def test_named_displays_capture(self): self.capture("displays")
    def test_default_capture(self): self.capture("default")
    def test_rejected_fold_falls_back(self): self.capture("rejected")
    def test_missing_device_fails_clearly(self): self.capture("missing")
    def test_explicit_device_override(self): self.capture("missing", override="custom.duo")
    def test_failed_run_removes_stale_captures(self): self.capture("test-failure")


if __name__ == "__main__":
    unittest.main()
