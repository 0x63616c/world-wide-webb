"""Guard suite coverage and the aggregate release gate against workflow drift."""
from pathlib import Path
import os
import re
import subprocess
import unittest

WORKFLOW = (Path(__file__).parents[1] / "workflows/apple-panel-testflight.yml").read_text()


class ParallelSmokeTests(unittest.TestCase):
    def test_every_built_suite_runs_once(self):
        build = WORKFLOW.split("  smoke_build:", 1)[1].split("  smoke_tests:", 1)[0]
        suites = re.findall(r"-only-testing:PanelUITests/(\w+)", build)
        matrix = re.search(r"suite: \[([^\]]+)\]", WORKFLOW)[1]
        groups = [name.strip() for name in matrix.split(",")]
        self.assertCountEqual(groups, suites)
        self.assertEqual(len(groups), len(set(groups)))
        self.assertEqual(set(groups), {"HomeViewLaunchTests", "NotificationHistoryTests",
                                       "UpdateReadyBannerTests", "GridInteractionTests",
                                       "PersonalNavigationTests", "PanelReturnTests"})
        self.assertIn('"-only-testing:PanelUITests/$TEST_SUITE"', WORKFLOW)

    def test_gate_rejects_every_non_success_result(self):
        gate = WORKFLOW.split("  smoke:\n", 1)[1].split("  upload:", 1)[0]
        self.assertIn("needs: [plan, smoke_build, smoke_tests]", gate)
        command = re.search(r"        run: (.+)", gate)[1]
        for build in ["success", "failure", "cancelled", "skipped", ""]:
            for tests in ["success", "failure", "cancelled", "skipped", ""]:
                with self.subTest(build=build, tests=tests):
                    result = subprocess.run(["bash", "-c", command],
                                            env=dict(os.environ, BUILD_RESULT=build, TEST_RESULT=tests))
                    self.assertEqual(result.returncode == 0, build == tests == "success")


if __name__ == "__main__":
    unittest.main()
