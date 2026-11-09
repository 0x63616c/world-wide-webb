import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
from deployment_plan import plan_deployment


def generation():
    names = ["control-center", "penpot", "home-assistant"]
    return {
        "host": "fixture",
        "services": names,
        "backupsEnabled": True,
        "inputs": {
            "version": 1,
            "shared": {s: "a" * 64 for s in ("host", "safety", "containers", "home-assistant")},
            "services": {s: {f: "a" * 64 for f in ("configuration", "storage", "secrets")} for s in names},
        },
    }


class PlannerTests(unittest.TestCase):
    def test_unrelated_source_and_monitor_changes_do_not_touch_applications(self):
        old = generation()
        new = copy.deepcopy(old)
        new["revision"] = "new-source"
        new["monitor"] = "new-address"
        result = plan_deployment(old, new)
        self.assertEqual(result["backup"], [])
        self.assertEqual(result["reconcile"], [])
        self.assertEqual(old, generation())

    def test_image_or_secret_change_selects_only_its_application(self):
        for field in ("configuration", "secrets"):
            old, new = generation(), generation()
            new["inputs"]["services"]["control-center"][field] = "b" * 64
            result = plan_deployment(old, new)
            self.assertEqual(result["backup"], ["control-center"])
            self.assertEqual(result["recovery"], "local")

    def test_vm_changes_require_affected_off_host_copies(self):
        for group, expected in [("containers", ["control-center", "penpot"]), ("home-assistant", ["home-assistant"])]:
            old, new = generation(), generation()
            new["inputs"]["shared"][group] = "b" * 64
            result = plan_deployment(old, new)
            self.assertEqual(result["backup"], expected)
            self.assertEqual(result["recovery"], "off-host")
            if group == "home-assistant":
                self.assertIn("control-center", result["health"])
                self.assertNotIn("control-center", result["reconcile"])

    def test_missing_metadata_and_safety_changes_preserve_full_protection(self):
        old, new = generation(), generation()
        old.pop("inputs")
        result = plan_deployment(old, new)
        self.assertTrue(result["legacy"])
        self.assertEqual(result["backup"], old["services"])
        self.assertEqual(result["recovery"], "off-host")
        old = generation()
        new["inputs"]["shared"]["safety"] = "b" * 64
        self.assertEqual(plan_deployment(old, new)["backup"], old["services"])

    def test_invalid_or_removed_assignment_fails_before_actions(self):
        old, new = generation(), generation()
        new["services"].remove("penpot")
        with self.assertRaisesRegex(ValueError, "removal"):
            plan_deployment(old, new)
        new = generation()
        new["inputs"]["services"]["penpot"]["secrets"] = "plaintext"
        with self.assertRaisesRegex(ValueError, "digest"):
            plan_deployment(old, new)


if __name__ == "__main__":
    unittest.main()
