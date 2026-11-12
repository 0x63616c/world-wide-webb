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
import threading
import time
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


class HostControlProtocolTests(unittest.TestCase):
    def test_slow_native_control_is_not_abandoned_before_acknowledgement(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            elapsed = [0.0]

            def pause(seconds):
                elapsed[0] += seconds
                if elapsed[0] >= 65:
                    request = json.loads((directory / "host-request.json").read_text())
                    (directory / "host-response.json").write_text(json.dumps({"id": request["id"], "ok": True}))

            with (
                patch.object(duo.time, "monotonic", side_effect=lambda: elapsed[0]),
                patch.object(duo.time, "sleep", side_effect=pause),
            ):
                duo.host_command(directory, {"orientation": "portrait"})
            self.assertGreaterEqual(elapsed[0], 65)

    def test_timeout_identifies_the_control_and_retains_native_log_tail(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "host-response.json").write_text(json.dumps({"id": "previous", "ok": True}))
            (directory / "host-control.log").write_text("Waiting for Device Hub to idle before Portrait\n")
            with patch.object(duo.time, "monotonic", side_effect=[0, 0, 121]), patch.object(duo.time, "sleep"):
                with self.assertRaises(ValueError) as failure:
                    duo.host_command(directory, {"orientation": "portrait"})
            self.assertIn("portrait", str(failure.exception))
            self.assertIn("Waiting for Device Hub to idle", str(failure.exception))
            self.assertEqual(
                json.loads((directory / "native-control-timeout.json").read_text())["control"],
                {"orientation": "portrait"},
            )

    def test_orientation_selects_pose_before_rotation_and_waits_for_both(self):
        for accepted in (True, False):
            with self.subTest(accepted=accepted), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                (directory / "plan.json").write_text(json.dumps({"mode": "fold", "host_control": True}))
                (directory / "request.json").write_text(
                    json.dumps({"id": "turn-inner", "action": "orientation", "name": "landscape-right"})
                )
                response = directory / "response.json"
                physical = {"pose": "outer", "orientation": "portrait"}

                def orient(folder, command):
                    self.assertFalse(response.exists())
                    physical["orientation"] = command["orientation"]

                def select_pose(folder, pose):
                    self.assertFalse(response.exists())
                    if not accepted:
                        raise ValueError("Display selection failed")
                    physical.update(pose=pose, orientation="portrait")

                def pause(seconds):
                    if response.exists():
                        raise StopIteration

                with (
                    patch.object(duo, "host_command", side_effect=orient),
                    patch.object(duo, "host_pose", side_effect=select_pose),
                    patch.object(duo.time, "sleep", side_effect=pause),
                ):
                    with self.assertRaises(StopIteration):
                        duo.serve("duo", directory, directory, "light")
                result = json.loads(response.read_text())
                self.assertEqual(result["id"], "turn-inner")
                self.assertEqual(result["ok"], accepted)
                if accepted:
                    self.assertEqual(physical, {"pose": "inner", "orientation": "landscape-right"})
                else:
                    self.assertIn("selection failed", result["error"])

    def test_acknowledged_pose_is_not_reselected_for_each_orientation(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "plan.json").write_text(json.dumps({"mode": "fold", "host_control": True}))
            requests = [("pose", "outer"), ("orientation", "landscape-left"), ("orientation", "portrait")]
            index = [0]
            calls = []

            def send():
                action, name = requests[index[0]]
                (directory / "request.json").write_text(
                    json.dumps({"id": str(index[0]), "action": action, "name": name})
                )

            def pause(_seconds):
                response = directory / "response.json"
                if response.exists():
                    value = json.loads(response.read_text())
                    self.assertTrue(value["ok"], value)
                    response.unlink()
                    index[0] += 1
                    if index[0] == len(requests):
                        raise StopIteration
                    send()

            send()
            with (
                patch.object(duo, "host_pose", side_effect=lambda _folder, pose: calls.append({"pose": pose})),
                patch.object(duo, "host_command", side_effect=lambda _folder, command: calls.append(command)),
                patch.object(duo.time, "sleep", side_effect=pause),
            ):
                with self.assertRaises(StopIteration):
                    duo.serve("duo", directory, directory, "light")
            self.assertEqual(calls, [{"pose": "outer"}, {"orientation": "landscape-left"}, {"orientation": "portrait"}])

    def test_orientation_waits_for_its_own_acknowledgement(self):
        for accepted in (True, False):
            with self.subTest(accepted=accepted), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                # A previous command's acknowledgement must never complete this one.
                (directory / "host-response.json").write_text(json.dumps({"id": "previous", "ok": True}))
                observed = []

                def controller():
                    deadline = time.monotonic() + 2
                    while time.monotonic() < deadline:
                        path = directory / "host-request.json"
                        if path.exists():
                            command = json.loads(path.read_text())
                            observed.append(command)
                            response = directory / "controller-response.tmp"
                            response.write_text(json.dumps({"id": command["id"], "ok": accepted}))
                            response.replace(directory / "host-response.json")
                            return
                        time.sleep(0.01)

                worker = threading.Thread(target=controller)
                worker.start()
                try:
                    if accepted:
                        duo.host_command(directory, {"orientation": "landscape-right"})
                    else:
                        with self.assertRaisesRegex(ValueError, "control failed"):
                            duo.host_command(directory, {"orientation": "landscape-right"})
                finally:
                    worker.join(timeout=3)
                self.assertFalse(worker.is_alive())
                self.assertEqual(observed[0]["orientation"], "landscape-right")
                self.assertNotEqual(observed[0]["id"], "previous")


MOCK_TOOL = r"""#!/usr/bin/env python3
import base64, json, os, pathlib, sys, time
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
mode = os.environ["MOCK_DUO_MODE"]
if name == "ruby":
    print({"project_path":"apps/tendr/Still.xcodeproj", "scheme":"Still", "duo_screenshot_test":"StillUITests/DuoScreenshotTests/testMainScreens", "name":"Tendr"}[args[-1]])
elif name == "xcrun":
    args = args[1:]
    with open(os.environ["MOCK_SIMCTL_LOG"], "a") as log:
        log.write(json.dumps(args) + "\n")
    if args[:2] == ["list", "devicetypes"]:
        print(json.dumps({"devicetypes": [] if mode == "missing" else [{"name":"iPhone Duo", "identifier":"mock.duo"}]}))
    elif args[:2] == ["list", "runtimes"]:
        print(json.dumps({"runtimes":[{"platform":"iOS", "isAvailable":True,"version":"27.2","identifier":"com.apple.CoreSimulator.SimRuntime.iOS-27-2-iPhone19-4"}]}))
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
        elif mode in ("displays", "integrated") and args[-1] == "io":
            print("screenshot --display=<id>")
        else:
            print("No fold or named display support")
    elif args[0] == "fold" and mode == "rejected":
        sys.exit(1)
    elif args[0] == "io" and args[2] == "enumerate":
        if mode == "integrated":
            print("Screen ID: 1\n Name: LCD\n Screen Type: Integrated\nScreen ID: 2\n Name: TVOut\n Screen Type: TVOut\nScreen ID: 3\n Name: LCD-1\n Screen Type: Integrated")
        else:
            print("Display 0: Inner\nDisplay 1: Outer" if mode == "displays" else "Display 0: Main")
    elif args[0] == "io" and args[2] == "screenshot":
        if mode == "integrated" and not any(arg.startswith("--display=") for arg in args):
            sys.exit("Cannot choose between 2 displays. Specify --display")
        pathlib.Path(args[-1]).write_bytes(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="))
elif name == "xcodebuild" and args[0] == "build-for-testing":
    pathlib.Path(os.environ["MOCK_XCODE_ARGS"]).write_text(json.dumps(args))
elif name == "xcodebuild" and args[0] == "test-without-building":
    with open(os.environ["MOCK_TEST_ARGUMENTS"], "a") as log:
        log.write(json.dumps(args) + "\n")
    folder = pathlib.Path(os.environ["TEST_RUNNER_DUO_CONTROL_DIR"])
    if mode in ("native-timeout-once", "native-timeout-always", "native-timeout-cancelled"):
        count = pathlib.Path(os.environ["MOCK_TEST_COUNT"])
        invocation = int(count.read_text()) + 1 if count.exists() else 1
        count.write_text(str(invocation))
        if mode != "native-timeout-once" or invocation == 1:
            (folder / "native-control-timeout.json").write_text(json.dumps({"control": {"orientation": "portrait"}}))
            (folder / "host-control.log").write_text("Native control timeout fixture\n")
            sys.exit(143 if mode == "native-timeout-cancelled" else 65)
    if mode == "test-failure":
        (folder / "host-control.log").write_text("Native control request stalled at Portrait\n")
        (folder / "live-fold-1-outer-before.txt").write_text("Synthetic fixture window\n")
        (folder / "light").mkdir(exist_ok=True)
        (folder / "light/outer-light-home.png").write_bytes(b"partial fixture capture")
        (folder / "DuoScreenshotTests-light.xcresult").mkdir()
        (folder / "DuoScreenshotTests-light.xcresult/Info.plist").write_text("fixture result")
        sys.exit("Mock test failure")
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
        for shot in json.loads(os.environ["TEST_RUNNER_DUO_CAPTURE_SHOTS"]):
            request("appearance", shot["appearance"])
            request("capture", shot["screen"])
"""


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
                    ["xcrun", "simctl", "help", "io"],
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    timeout=expected,
                    check=True,
                )

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
        self.assertEqual(duo.named_displays("Display 2: Inner\nDisplay 4: Outer"), {"inner": "2", "outer": "4"})
        self.assertEqual(
            duo.named_displays(
                json.dumps({"displays": [{"id": 3, "name": "Inner display"}, {"id": 7, "name": "Outer display"}]})
            ),
            {"inner": "3", "outer": "7"},
        )

    def test_device_hub_bridge_requires_both_enumerated_native_modes_and_ready_controller(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "plan.json").write_text(json.dumps({"mode": "unmapped"}))
            enumeration = "Screen ID: 8\n Screen Type: Integrated\n Pixel Size: {2007, 2853}\nScreen ID: 2\n Screen Type: Integrated\n Pixel Size: {1398, 2034}\n"
            (folder / "simctl-capabilities.txt").write_text(enumeration)
            with self.assertRaises(ValueError):
                duo.configure_host(folder, set_pose=lambda directory, pose: self.assertEqual(pose, "inner"))
            (folder / "host-ready").touch()
            duo.configure_host(folder, set_pose=lambda directory, pose: self.assertEqual(pose, "inner"))
            plan = json.loads((folder / "plan.json").read_text())
            self.assertEqual(plan, {"mode": "fold", "host_control": True, "displays": {"inner": "8", "outer": "2"}})
            (folder / "plan.json").write_text(json.dumps({"mode": "unmapped"}))
            (folder / "simctl-capabilities.txt").write_text(
                enumeration.replace("2007, 2853", "2853, 2007").replace("1398, 2034", "2034, 1398")
            )
            duo.configure_host(folder, set_pose=lambda directory, pose: self.assertEqual(pose, "inner"))
            self.assertEqual(json.loads((folder / "plan.json").read_text())["displays"], {"inner": "8", "outer": "2"})
            for invalid in ["", enumeration.replace("1398, 2034", "720, 480"), enumeration + enumeration]:
                (folder / "plan.json").write_text(json.dumps({"mode": "unmapped"}))
                (folder / "simctl-capabilities.txt").write_text(invalid)
                with self.assertRaises(ValueError):
                    duo.configure_host(folder, set_pose=lambda directory, pose: self.assertEqual(pose, "inner"))

    def test_no_undocumented_fold_command_is_attempted(self):
        self.assertEqual(duo.fold_candidates("test", {}), [])
        self.assertEqual(duo.fold_candidates("test", {"ui": "appearance light dark"}), [])
        commands = duo.fold_candidates("test", {"ui": "fold <state>: folded unfolded"})
        self.assertEqual(
            commands, [{"outer": ["ui", "test", "fold", "folded"], "inner": ["ui", "test", "fold", "unfolded"]}]
        )

    def capture(self, mode, override=None, devices=None, release=None):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scripts = root / "scripts"
            scripts.mkdir()
            for name in [
                "capture-duo-screenshots.sh",
                "duo-simulator.py",
                "boot-simulator.sh",
                "screenshot-build-settings.py",
            ]:
                shutil.copy2(ROOT / "scripts" / name, scripts / name)
            (root / "apps/tendr").mkdir(parents=True)
            shutil.copy2(ROOT / "apps/tendr/screenshots.json", root / "apps/tendr/screenshots.json")
            commands = root / "bin"
            commands.mkdir()
            tool = commands / "mock-tool"
            tool.write_text(MOCK_TOOL)
            tool.chmod(0o755)
            for name in ["ruby", "xcrun", "xcodebuild"]:
                (commands / name).symlink_to(tool)
            env = dict(
                os.environ,
                PATH=f"{commands}:{os.environ['PATH']}",
                MOCK_DUO_MODE=mode,
                MOCK_CREATED_DEVICE=str(root / "created-device"),
                MOCK_XCODE_ARGS=str(root / "build-arguments.json"),
                MOCK_TEST_ARGUMENTS=str(root / "test-arguments.jsonl"),
                MOCK_TEST_COUNT=str(root / "test-invocations"),
                MOCK_SIMCTL_LOG=str(root / "simctl.jsonl"),
                MOCK_SIMULATORS=json.dumps({"devices": devices or {}}),
            )
            env.pop("R_SIM_DEVICE_TYPE", None)
            env.pop("R_SIM_RUNTIME", None)
            for key in (
                "RELEASE_MANIFEST",
                "RELEASE_VERSION",
                "RELEASE_BUILD",
                "DUO_CAPTURE_ATTEMPT",
                "DUO_CAPTURE_REPORT",
            ):
                env.pop(key, None)
            if release:
                manifest = root / "release-manifest.json"
                manifest.write_text(
                    json.dumps({"app": "tendr", "version": release[0], "build": release[1], "sha": "release-source"})
                )
                env.update(RELEASE_MANIFEST=str(manifest), RELEASE_VERSION=release[0], GITHUB_SHA="release-source")
            if override:
                env["R_SIM_DEVICE_TYPE"] = override
            output = root / "output with spaces"
            output.mkdir()
            for pose in ["inner", "outer", "default"]:
                for appearance in ["light", "dark"]:
                    (output / f"{pose}-{appearance}-obsolete.png").write_bytes(b"stale")
            for filename in ["plan.json", "capture-notes.txt", "simctl-capabilities.txt"]:
                (output / filename).write_text("stale")
            (output / "default-screen-1-light-obsolete.png").write_bytes(b"stale")
            (output / "default-screen-unrelated.png").write_bytes(b"user file")
            (output / "keep.txt").write_text("unrelated user file")
            result = subprocess.run(
                ["bash", str(scripts / "capture-duo-screenshots.sh"), "tendr", str(output)],
                text=True,
                capture_output=True,
                env=env,
                timeout=55,
            )
            self.assertFalse(list(output.glob("*-obsolete.png")))
            self.assertEqual((output / "default-screen-unrelated.png").read_bytes(), b"user file")
            self.assertEqual((output / "keep.txt").read_text(), "unrelated user file")
            creations = [
                json.loads(line)
                for line in (root / "simctl.jsonl").read_text().splitlines()
                if json.loads(line)[0] == "create"
            ]
            if mode == "native-timeout-cancelled":
                self.assertEqual(result.returncode, 143, result.stdout + result.stderr)
                self.assertEqual(len(creations), 1, "Cancellation must stop capture without retrying")
                return
            if mode == "native-timeout-always":
                self.assertEqual(result.returncode, 65, result.stdout + result.stderr)
                self.assertEqual(len(creations), 2, "Native recovery must be bounded to one fresh retry")
                self.assertEqual(len(list((output / "diagnostics").glob("run.*"))), 2)
                self.assertEqual([file.name for file in output.glob("*.png")], ["default-screen-unrelated.png"])
                return
            if mode == "missing" and override is None:
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("No iPhone Duo simulator device type found", result.stderr)
                self.assertFalse((output / "plan.json").exists())
                return
            if mode == "test-failure":
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Mock test failure", result.stderr)
                self.assertEqual([file.name for file in output.glob("*.png")], ["default-screen-unrelated.png"])
                self.assertEqual(len(creations), 1, "App/test failures must not trigger native recovery")
                diagnostics = list((output / "diagnostics").glob("run.*"))
                self.assertEqual(len(diagnostics), 1, "Release artifacts must retain native failure evidence")
                evidence = diagnostics[0]
                self.assertIn("stalled at Portrait", (evidence / "host-control.log").read_text())
                self.assertEqual((evidence / "live-fold-1-outer-before.txt").read_text(), "Synthetic fixture window\n")
                self.assertEqual((evidence / "light/outer-light-home.png").read_bytes(), b"partial fixture capture")
                self.assertTrue((evidence / "DuoScreenshotTests-light.xcresult/Info.plist").is_file())
                return
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            if mode == "native-timeout-once":
                self.assertEqual(len(creations), 2, "Recovery must recreate the simulator and rerun both appearances")
                self.assertEqual(len(list((output / "diagnostics").glob("run.*"))), 1)
                self.assertIn("Retrying the complete Duo capture", result.stderr)
            if release:
                arguments = json.loads((root / "build-arguments.json").read_text())
                self.assertIn(f"MARKETING_VERSION={release[0]}", arguments)
                self.assertIn(f"CURRENT_PROJECT_VERSION={release[1]}", arguments)
            test_arguments = [json.loads(line) for line in (root / "test-arguments.jsonl").read_text().splitlines()]
            self.assertEqual(len(test_arguments), 2 if mode == "native-timeout-once" else 1)
            self.assertIn("-only-testing:StillUITests/DuoScreenshotTests/testMainScreens", test_arguments[-1])
            plan = json.loads((output / "plan.json").read_text())
            expected_mode = "unmapped" if mode == "integrated" else mode if mode in ("fold", "displays") else "default"
            self.assertEqual(plan["mode"], expected_mode)
            poses = (
                list(plan["displays"])
                if expected_mode == "unmapped"
                else ["inner", "outer"]
                if expected_mode in ("fold", "displays")
                else ["default"]
            )
            self.assertEqual(len(list(output.glob("*.png"))), len(poses) * 5 + 1)
            for pose in poses:
                for shot in json.loads((ROOT / "apps/tendr/screenshots.json").read_text())["duo_shots"]:
                    self.assertTrue((output / f"{pose}-{shot['appearance']}-{shot['screen']}.png").is_file())
            self.assertEqual((root / "created-device").read_text(), override or "mock.duo")
            if expected_mode == "default":
                self.assertIn("default only", (output / "capture-notes.txt").read_text())
            return [json.loads(line) for line in (root / "simctl.jsonl").read_text().splitlines()]

    def test_stale_simulators_are_removed_before_creation_and_boot(self):
        commands = self.capture(
            "default",
            devices={
                "com.apple.CoreSimulator.SimRuntime.iOS-27-1": [
                    {"name": "Tendr Duo Screenshots", "udid": "stale-booted", "state": "Booted", "isAvailable": True},
                    {"name": "Tendr Screenshots", "udid": "other-capture", "state": "Booted", "isAvailable": True},
                    {
                        "name": "Personal Tendr Duo Screenshots",
                        "udid": "personal",
                        "state": "Booted",
                        "isAvailable": True,
                    },
                    {"name": "Samplr Duo Screenshots", "udid": "other-app", "state": "Booted", "isAvailable": True},
                ],
                "mock.ios26": [
                    {
                        "name": "Tendr Duo Screenshots old-run",
                        "udid": "stale-shutdown",
                        "state": "Shutdown",
                        "isAvailable": False,
                    },
                ],
            },
        )
        lifecycle = [command for command in commands if command[0] in ("shutdown", "delete", "create", "boot")]
        self.assertEqual(
            lifecycle,
            [
                ["shutdown", "stale-booted"],
                ["delete", "stale-booted"],
                ["shutdown", "stale-shutdown"],
                ["delete", "stale-shutdown"],
                [
                    "create",
                    "Tendr Duo Screenshots",
                    "mock.duo",
                    "com.apple.CoreSimulator.SimRuntime.iOS-27-2-iPhone19-4",
                ],
                ["boot", "mock-udid"],
                ["shutdown", "mock-udid"],
                ["delete", "mock-udid"],
            ],
        )

    def test_fold_capture(self):
        self.capture("fold")

    def test_named_displays_capture(self):
        self.capture("displays")

    def test_unnamed_integrated_screens_use_reported_ids(self):
        commands = self.capture("integrated")
        screenshots = [command for command in commands if command[:1] == ["io"] and command[2] == "screenshot"]
        self.assertTrue(screenshots)
        selectors = {argument for command in screenshots for argument in command if argument.startswith("--display=")}
        self.assertEqual(selectors, {"--display=1", "--display=3"})

    def test_default_capture(self):
        self.capture("default")

    def test_rejected_fold_falls_back(self):
        self.capture("rejected")

    def test_missing_device_fails_clearly(self):
        self.capture("missing")

    def test_explicit_device_override(self):
        self.capture("missing", override="custom.duo")

    def test_failed_run_removes_stale_captures(self):
        self.capture("test-failure")

    def test_release_capture_uses_processed_build_metadata(self):
        self.capture("default", release=("1.1.1", "1"))

    def test_release_recovers_one_native_timeout_with_a_fresh_complete_capture(self):
        self.capture("native-timeout-once", release=("1.1.1", "1"))

    def test_repeated_native_timeouts_stop_release_after_one_retry(self):
        self.capture("native-timeout-always", release=("1.1.1", "1"))

    def test_release_does_not_retry_app_or_test_failures(self):
        self.capture("test-failure", release=("1.1.1", "1"))

    def test_release_does_not_retry_cancelled_capture(self):
        self.capture("native-timeout-cancelled", release=("1.1.1", "1"))


if __name__ == "__main__":
    unittest.main()
