"""Exercise routing and the required gate without starting any product runtimes."""

import copy
import json
import tempfile
import unittest
from pathlib import Path

from dispatch import dispatch, write_receipts
from gate import verify
from select_units import CONFIG

CONFIGURATION = json.loads(CONFIG.read_text())


class DispatchTests(unittest.TestCase):
    def test_unselected_control_center_artifact_matches_delivery_consumers(self):
        receipt = {"head": "a" * 40, "verify": ["sites.folding"]}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_receipts(root, receipt)
            self.assertEqual(json.loads((root / "ci-selection.json").read_text()), receipt)
            artifact = root / "control-center" / "ci-selection.json"
            selected = json.loads(artifact.read_text())
            self.assertIs(selected["publish_apple"], False)
            self.assertIs(selected["publish_image"], False)
            self.assertIs(selected["apply_infra"], False)
            self.assertFalse(any(selected.values()))

    def test_docs_and_unrelated_products_do_not_run(self):
        self.assertEqual(dispatch(["docs/example.md"], CONFIGURATION)["products"], [])
        self.assertEqual(
            dispatch(["projects/minecraft/src/client/java/dev/calum/mctuner/MinecraftTuner.java"], CONFIGURATION)[
                "products"
            ],
            ["minecraft"],
        )
        self.assertEqual(
            dispatch(["projects/folding/apps/ios/App/FoldingScreens.swift"], CONFIGURATION)["products"], ["folding"]
        )
        self.assertEqual(
            dispatch(["projects/folding/backend/tests/sessions.test.mjs"], CONFIGURATION)["products"], ["folding"]
        )
        self.assertEqual(dispatch(["scripts/ci/test_select.py"], CONFIGURATION)["products"], [])

    def test_unknown_inputs_fail_before_product_jobs(self):
        with self.assertRaisesRegex(ValueError, "new-owner/file.rs"):
            dispatch(["new-owner/file.rs"], CONFIGURATION)

    def test_security_follows_languages_not_products(self):
        self.assertEqual(
            dispatch(["projects/golink-safari/Extension/redirect.js"], CONFIGURATION)["security_languages"], []
        )
        self.assertEqual(
            dispatch(["projects/folding/backend/crates/worker/src/lib.rs"], CONFIGURATION)["security_languages"],
            ["rust"],
        )

    def test_required_gate_rejects_failed_selected_or_unexpected_skips(self):
        empty = {
            name: {"result": "skipped"}
            for name in (
                "control-center",
                "folding",
                "tendr",
                "tapes",
                "callkeep",
                "golink",
                "minecraft",
                "golden-pixel",
                "homelab",
                "sites",
                "typecheck",
                "test-unit",
                "security",
            )
        }
        empty["changes"] = {
            "result": "success",
            "outputs": {"products": "[]", "tooling": "false", "security_languages": "[]"},
        }
        verify(empty)
        selected = copy.deepcopy(empty)
        selected["changes"]["outputs"]["products"] = '["folding"]'
        with self.assertRaises(ValueError):
            verify(selected)
        selected["folding"]["result"] = "success"
        verify(selected)
        selected["folding"]["result"] = "failure"
        with self.assertRaises(ValueError):
            verify(selected)

    def test_tapes_runs_its_server_checks_and_the_standard_ios_build(self):
        self.assertEqual(dispatch(["projects/tapes/server/src/api.rs"], CONFIGURATION)["products"], ["tapes"])
        self.assertEqual(dispatch(["projects/tapes/Sources/Browse.swift"], CONFIGURATION)["products"], ["tapes"])
        needs = {
            name: {"result": "skipped"}
            for name in (
                "control-center",
                "folding",
                "callkeep",
                "golink",
                "minecraft",
                "golden-pixel",
                "homelab",
                "sites",
            )
        }
        needs.update(
            {name: {"result": "skipped"} for name in ("typecheck", "test-unit", "security")},
            changes={
                "result": "success",
                "outputs": {"products": '["tapes"]', "tooling": "false", "security_languages": "[]"},
            },
            tapes={"result": "success"},
            tendr={"result": "skipped"},
        )
        with self.assertRaises(ValueError):
            verify(needs)
        needs["tendr"]["result"] = "success"
        verify(needs)
