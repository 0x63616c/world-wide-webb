"""Pinned runtime selection and disposable CI device creation policy."""

import importlib.util
import json
import pathlib
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "apple_environment", pathlib.Path(__file__).with_name("apple-build-environment.py")
)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class DevicePolicyTests(unittest.TestCase):
    def test_only_missing_pinned_device_is_created_and_existing_device_is_reused(self):
        simulator = module.pins["simulator"]
        for existing in (False, True):
            with self.subTest(existing=existing):
                devices = (
                    [{"udid": "fixture-device", "state": "Shutdown", "deviceTypeIdentifier": simulator["device_type"]}]
                    if existing
                    else []
                )
                creations = []

                def output(*args):
                    if args[2:4] == ("list", "runtimes"):
                        return json.dumps(
                            {
                                "runtimes": [
                                    {
                                        "identifier": simulator["runtime"],
                                        "buildversion": simulator["build"],
                                        "isAvailable": True,
                                    }
                                ]
                            }
                        )
                    if args[2:4] == ("list", "devices"):
                        return json.dumps({"devices": {simulator["runtime"]: devices}})
                    self.assertEqual(
                        args,
                        ("xcrun", "simctl", "create", "Folding Duo", simulator["device_type"], simulator["runtime"]),
                    )
                    creations.append(args)
                    devices.append(
                        {
                            "udid": "fixture-device",
                            "state": "Shutdown",
                            "deviceTypeIdentifier": simulator["device_type"],
                        }
                    )
                    return "fixture-device"

                with patch.object(module, "output", output):
                    self.assertEqual(module.resolve_device(simulator, create=True), "fixture-device")
                self.assertEqual(len(creations), 0 if existing else 1)

    def test_missing_or_wrong_runtime_build_fails_before_creating_device(self):
        simulator = module.pins["simulator"]
        for runtimes in ([], [{"identifier": simulator["runtime"], "buildversion": "wrong", "isAvailable": True}]):
            with patch.object(module, "output", return_value=json.dumps({"runtimes": runtimes})) as output:
                with self.assertRaisesRegex(ValueError, "pinned"):
                    module.resolve_device(simulator, create=True)
                self.assertEqual(output.call_count, 1)

    def test_default_missing_device_is_read_only(self):
        simulator = module.pins["simulator"]
        responses = [
            json.dumps(
                {
                    "runtimes": [
                        {"identifier": simulator["runtime"], "buildversion": simulator["build"], "isAvailable": True}
                    ]
                }
            ),
            json.dumps({"devices": {}}),
        ]
        with patch.object(module, "output", side_effect=responses) as output:
            with self.assertRaisesRegex(ValueError, "Create"):
                module.resolve_device(simulator)
            self.assertEqual(output.call_count, 2)


if __name__ == "__main__":
    unittest.main()
