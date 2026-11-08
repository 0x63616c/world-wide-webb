import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('routes', pathlib.Path(__file__).parents[1] / 'scripts/check-runner-routes.py')
routes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(routes)


class RunnerRouteTests(unittest.TestCase):
    def test_generic_jobs_can_be_dispatched_to_either_os_and_are_rejected(self):
        for labels in ['self-hosted', 'ARM64', ['self-hosted', 'ARM64']]:
            self.assertIsNotNone(routes.job_problem({'runs-on': labels}))

    def test_static_hosted_and_explicit_platform_routes_pass(self):
        for labels in ['ubuntu-latest', 'macos-26', 'homelab-tart', 'homelab-linux',
                       ['self-hosted', 'Linux', 'ARM64', 'homelab-linux']]:
            self.assertIsNone(routes.job_problem({'runs-on': labels}))

    def test_dynamic_external_and_conflicting_routes_require_review(self):
        for job in [{'runs-on': '${{ matrix.runner }}'},
                    {'uses': 'owner/repo/.github/workflows/build.yml@main'},
                    {'runs-on': ['homelab-tart', 'Linux']}]:
            self.assertIsNotNone(routes.job_problem(job))
