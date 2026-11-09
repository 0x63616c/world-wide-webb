"""Execute the actual aggregate policy against selected/skipped/failed job results."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[2]


class StandardGateTests(unittest.TestCase):
    def test_linux_storefront_recovery_installs_its_github_client_before_credentials(self):
        jobs = yaml.safe_load((ROOT / '.github/workflows/storefront-status.yml').read_text())['jobs']
        job = jobs['public-availability']
        self.assertEqual(job['runs-on'], 'ubuntu-24.04-arm')
        steps = job['steps']
        installed = next(index for index, step in enumerate(steps) if step.get('uses') == './.github/actions/github-cli')
        for index, step in enumerate(steps):
            if step.get('run') == 'python3 scripts/resume-release.py':
                self.assertIn("vars.STANDARD_IOS_DELIVERY_ENABLED == 'true'", step['if'])
            if step.get('run') == 'python3 scripts/resume-release.py' or 'ASC_KEY_CONTENT' in step.get('env', {}):
                self.assertLess(installed, index)

    def test_selected_jobs_must_succeed_and_unselected_jobs_must_skip(self):
        jobs = yaml.safe_load((ROOT / '.github/workflows/tendr-ci.yml').read_text())['jobs']
        gate = jobs['gate']
        self.assertEqual(gate['if'], 'always() && !cancelled()')
        self.assertEqual(set(gate['needs']), {'changes', 'tooling', 'rdesign', 'app', 'template', 'backends'})
        script = gate['steps'][0]['run']
        base = {
            'changes': {'result': 'success', 'outputs': {'apps': '[]', 'tooling': 'false', 'rdesign': 'false', 'template': 'false', 'backends': '[]'}},
            **{job: {'result': 'skipped'} for job in ('tooling', 'rdesign', 'app', 'template', 'backends')},
        }

        def succeeds(results):
            return subprocess.run(['bash', '-e', '-c', script],
                                  env=dict(os.environ, RESULTS=json.dumps(results), PATH=str(Path(sys.executable).parent) + os.pathsep + os.environ['PATH']),
                                  capture_output=True).returncode == 0

        self.assertTrue(succeeds(base))
        for field, value, required in (
            ('apps', '["tendr"]', {'app'}),
            ('tooling', 'true', {'tooling'}),
            ('rdesign', 'true', {'rdesign'}),
            ('template', 'true', {'template', 'backends'}),
            ('backends', '["samplr"]', {'backends'}),
        ):
            selected = copy.deepcopy(base)
            selected['changes']['outputs'][field] = value
            for job in required:
                selected[job]['result'] = 'success'
            self.assertTrue(succeeds(selected), field)
            for job in required:
                for result in ('success', 'failure', 'cancelled', 'skipped'):
                    variant = copy.deepcopy(selected)
                    variant[job]['result'] = result
                    self.assertEqual(succeeds(variant), result == 'success', (field, job, result))
        for job in ('tooling', 'rdesign', 'app', 'template', 'backends'):
            unexpected = copy.deepcopy(base)
            unexpected[job]['result'] = 'success'
            self.assertFalse(succeeds(unexpected), job)
        failed_selection = copy.deepcopy(base)
        failed_selection['changes']['result'] = 'failure'
        self.assertFalse(succeeds(failed_selection))


if __name__ == '__main__':
    unittest.main()
