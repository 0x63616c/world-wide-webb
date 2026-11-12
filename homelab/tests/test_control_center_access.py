"""Reproduce missing access after rebuilding a host under a new machine name."""

import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "control_center_access", Path(__file__).parents[1] / "scripts/control-center-access.py"
)
access = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(access)


class AccessTests(unittest.TestCase):
    def run_route(self, before=None, *, host="homelab-mac-mini", changed=None):
        state = copy.deepcopy(before or {})
        mutations = []

        def run(args, **kwargs):
            if args[1] == "status":
                value = {
                    "BackendState": "Running",
                    "Self": {
                        "HostName": host,
                        "Tags": ["tag:homelab"],
                        "DNSName": "homelab-mac-mini.tail8c014d.ts.net.",
                    },
                }
            elif args[1:3] == ["serve", "status"]:
                value = state
            else:
                mutations.append(args[1:])
                if args[2] != "advertise":
                    state.setdefault("Services", {})[access.SERVICE] = copy.deepcopy(access.EXPECTED)
                    if changed:
                        state.update(changed)
                value = {}
            return subprocess.CompletedProcess(args, 0, json.dumps(value), "")

        with patch.object(access.subprocess, "run", side_effect=run):
            access.reconcile("/tailscale")
        return state, mutations

    def test_rebuilt_mini_advertises_original_app_address_without_renaming_host(self):
        state, mutations = self.run_route()
        self.assertEqual(
            mutations,
            [
                ["serve", "--service=svc:homelab", "--https=443", "http://127.0.0.1:4202"],
                ["serve", "advertise", "svc:homelab"],
            ],
        )
        self.assertEqual(state["Services"]["svc:homelab"], access.EXPECTED)

    def test_preserves_node_routes_and_other_services(self):
        before = {
            "TCP": {"8000": {"HTTPS": True}},
            "Web": {"homelab-mac-mini.tail8c014d.ts.net:8000": {"Handlers": {"/": {"Proxy": "http://127.0.0.1:8000"}}}},
            "Services": {"svc:other": {"TCP": {"1234": {"TCPForward": "localhost:1234"}}}},
        }
        after, _ = self.run_route(before)
        self.assertEqual(access.unrelated(after), before)

    def test_restored_correct_route_reasserts_separate_advertisement(self):
        _, mutations = self.run_route({"Services": {access.SERVICE: access.EXPECTED}})
        self.assertEqual(mutations, [["serve", "advertise", "svc:homelab"]])

    def test_rejects_conflicting_service_and_funnel_before_any_change(self):
        fixtures = [
            {"Services": {access.SERVICE: {"Tun": True}}},
            {"AllowFunnel": {access.HOST: True}},
            {"Foreground": {"owner": {"Services": {access.SERVICE: access.EXPECTED}}}},
        ]
        for fixture in fixtures:
            with self.subTest(fixture=fixture), self.assertRaises(RuntimeError):
                self.run_route(fixture)

    def test_rejects_other_host(self):
        with self.assertRaisesRegex(RuntimeError, "production Mini"):
            self.run_route(host="homelab-macbook")

    def test_detects_unrelated_config_change(self):
        with self.assertRaisesRegex(RuntimeError, "unrelated"):
            self.run_route(changed={"TCP": {"9999": {"HTTP": True}}})


if __name__ == "__main__":
    unittest.main()
