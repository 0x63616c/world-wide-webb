import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

scripts = Path(__file__).parents[1] / "scripts"
sys.path.insert(0, str(scripts))
spec = importlib.util.spec_from_file_location("reconcile_selected", scripts / "reconcile-selected.py")
selected = importlib.util.module_from_spec(spec)
spec.loader.exec_module(selected)


class SelectedReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.config = Path(self.temp.name) / "settings.json"
        services = ["home-assistant", "control-center", "penpot"]
        self.config.write_text(
            json.dumps(
                {
                    "services": services,
                    "commands": {s: ["update", s] for s in services},
                    "healthCommands": {s: ["health", s] for s in services},
                    "pullCommands": {s: ["pull", s] for s in services},
                }
            )
        )

    def execute(self, arguments):
        with (
            patch.object(sys, "argv", ["reconcile", "--config", str(self.config), *arguments]),
            patch.object(selected, "run") as run,
            patch.object(selected, "admit_pull"),
        ):
            selected.main()
            return [call.args[0] for call in run.call_args_list]

    def test_selected_update_and_health_never_touch_unrelated_service(self):
        self.assertEqual(
            self.execute(["--services", "control-center", "--health", "control-center"]),
            [["update", "control-center"], ["health", "control-center"]],
        )

    def test_dependency_starts_first_and_health_finishes_after_updates(self):
        calls = self.execute([])
        self.assertEqual(calls[0], ["update", "home-assistant"])
        self.assertTrue(all(c[0] == "update" for c in calls[:3]))
        self.assertTrue(all(c[0] == "health" for c in calls[3:]))

    def test_health_only_capture_verification_performs_no_reconcile(self):
        self.assertEqual(self.execute(["--services", "--health", "penpot"]), [["health", "penpot"]])

    def test_invalid_health_fails_before_mutation(self):
        with patch.object(selected, "run") as run, self.assertRaises(ValueError):
            self.execute(["--services", "control-center", "--health", "unassigned"])
        run.assert_not_called()

    def test_pull_never_starts_or_probes_application(self):
        self.assertEqual(self.execute(["--pull", "--services", "control-center"]), [["pull", "control-center"]])

    def test_insufficient_vm_storage_refuses_before_pull(self):
        with (
            patch.object(sys, "argv", ["reconcile", "--config", str(self.config), "--pull", "--services", "penpot"]),
            patch.object(selected, "run") as run,
            patch.object(
                selected.subprocess,
                "check_output",
                return_value="Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/disk 10000 9999 1 99% /var/lib/docker\n",
            ),
            patch.object(
                selected.shutil, "disk_usage", return_value=__import__("types").SimpleNamespace(free=100 * 1024**3)
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "workspace"):
                selected.main()
            run.assert_not_called()
