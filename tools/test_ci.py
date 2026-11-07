import unittest
from ci_changes import classify
from ci_gate import verify


class CITests(unittest.TestCase):
    def test_selection_tracks_contract_and_deployment_dependencies(self):
        self.assertEqual(classify(['README.md']), dict(apple=False, image=False, infra=False))
        self.assertEqual(classify(['server/src/features/lights.rs']), dict(apple=True, image=True, infra=False))
        self.assertEqual(classify(['apple/App/HomeView.swift']), dict(apple=True, image=False, infra=False))
        self.assertEqual(classify(['deploy/mini/compose.yaml']), dict(apple=False, image=True, infra=False))
        self.assertEqual(classify(['infra/cloudflare/main.tf']), dict(apple=False, image=False, infra=True))
        self.assertTrue(all(classify(['.github/workflows/ci.yml']).values()))
        self.assertTrue(all(classify([], True).values()))

    def test_gate_rejects_missing_failed_cancelled_and_unexpectedly_skipped_checks(self):
        needs = {k: {'result': 'success'} for k in ['changes', 'typecheck', 'test-unit', 'apple', 'image', 'infra']}
        needs['changes']['outputs'] = dict(apple='true', image='true', infra='false')
        needs['infra']['result'] = 'skipped'
        verify(needs)
        for job in ['changes', 'typecheck', 'test-unit', 'apple', 'image', 'infra']:
            original = needs[job]['result']
            for result in ['failure', 'cancelled', 'missing'] + ([] if job == 'infra' else ['skipped']):
                needs[job]['result'] = result
                with self.assertRaises(ValueError):
                    verify(needs)
            needs[job]['result'] = original
        needs['changes']['outputs'].pop('apple')
        with self.assertRaises(ValueError):
            verify(needs)
