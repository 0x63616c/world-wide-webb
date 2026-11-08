#!/usr/bin/env python3
"""Local-only deployment overlay regression tests; never accesses a provider."""
import hashlib
import json
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent

class ReadinessTests(unittest.TestCase):
    def test_regeneration_preserves_reviewed_flags_and_rejects_changed_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = pathlib.Path(tmp)
            bindings = dict(environment='staging', api_origin='https://api-staging.getfolding.app',
                admin_origin='https://admin-staging.getfolding.app', access_audience='audience',
                worker_name='test', account_id='test', database_id='test', database_name='test',
                avatar_bucket='test', jobs_queue='test', dead_queue='test-dead')
            configuration = dict(APPLE_SIGN_IN_TEAM_ID='TEAM123456', APPLE_SIGN_IN_KEY_ID='KEY1234567',
                APP_ATTEST_ENVIRONMENT='development', APP_ATTEST_BUNDLE_VERSIONS='["1"]',
                ACCESS_TEAM_DOMAIN='https://test.cloudflareaccess.com', WORKER_VERSION='a'*40,
                ADMIN_EMAIL_ALLOWLIST='["test@example.com"]', APNS_KEY_ID='KEY1234567')
            config = directory / 'configuration.json'
            config.write_text(json.dumps(configuration))
            artifact = directory / 'acceptance.json'
            artifact.write_text('{"result":"passed","environment":"staging"}')
            evidence = dict(path=artifact.name, sha256=hashlib.sha256(artifact.read_bytes()).hexdigest())
            overlay = dict(environment='staging', worker_version='a'*40,
                bindings_sha256=hashlib.sha256(json.dumps(bindings,sort_keys=True,separators=(',', ':')).encode()).hexdigest(),
                reviewer='local-test', reviewed_at='2026-11-07T00:00:00Z',
                capabilities=['notifications.results'],
                features=dict(APNS_ENABLED=True, AVATAR_UPLOADS_ENABLED=False, ADMIN_EMAIL_ENABLED=False),
                evidence={'notifications.results':evidence, 'APNS_ENABLED':evidence})
            readiness = directory / 'readiness.json'
            readiness.write_text(json.dumps(overlay))
            output = directory / 'worker.json'
            command = ['python3', str(ROOT/'scripts/generate-worker-config.py'), '--configuration', str(config), '--output', str(output)]
            def run(with_overlay=True):
                return subprocess.run(command + (['--readiness',str(readiness)] if with_overlay else []),
                    input=json.dumps(bindings), text=True, capture_output=True)
            self.assertEqual(run(False).returncode, 0)
            generated = json.loads(output.read_text())
            self.assertEqual(generated['vars']['APNS_ENABLED'], 'false')
            self.assertEqual(generated['limits']['cpu_ms'], 5000)
            self.assertNotIn('MINIMUM_IOS_BUILD', generated['vars'])
            self.assertEqual(generated['observability']['head_sampling_rate'], 0.1)
            self.assertFalse(generated['observability']['logs']['invocation_logs'])
            self.assertEqual([r['simple']['limit'] for r in generated['ratelimits']], [600,60,120])
            self.assertEqual(len({r['namespace_id'] for r in generated['ratelimits']}),3)
            self.assertEqual(generated['queues']['consumers'][0]['max_batch_size'],10)
            configuration['MINIMUM_IOS_BUILD'] = '10'
            config.write_text(json.dumps(configuration))
            self.assertNotEqual(run(False).returncode, 0)
            configuration['MINIMUM_IOS_BUILD'] = '-1'
            config.write_text(json.dumps(configuration))
            self.assertNotEqual(run(False).returncode, 0)
            configuration.pop('MINIMUM_IOS_BUILD')
            config.write_text(json.dumps(configuration))
            preview = subprocess.run(command + ['--testflight-preview'],
                                     input=json.dumps(bindings), text=True, capture_output=True)
            self.assertEqual(preview.returncode, 0, preview.stderr)
            preview_vars = json.loads(output.read_text())['vars']
            self.assertEqual(preview_vars['APNS_ENABLED'], 'true')
            self.assertEqual(preview_vars['AVATAR_UPLOADS_ENABLED'], 'true')
            self.assertEqual(preview_vars['ADMIN_EMAIL_ENABLED'], 'false')
            self.assertEqual(preview_vars['VERIFIED_CAPABILITIES'], '[]')
            self.assertNotEqual(subprocess.run(command + ['--testflight-preview', '--readiness', str(readiness)],
                             input=json.dumps(bindings), text=True, capture_output=True).returncode, 0)
            self.assertEqual(run().returncode, 0)
            initial = output.read_bytes()
            self.assertEqual(json.loads(initial)['vars']['APNS_ENABLED'], 'true')
            self.assertEqual(run().returncode, 0)
            self.assertEqual(output.read_bytes(), initial)
            artifact.write_text('changed')
            self.assertNotEqual(run().returncode, 0)
            self.assertEqual(output.read_bytes(), initial)
            overlay['worker_version'] = 'b'*40
            readiness.write_text(json.dumps(overlay))
            self.assertNotEqual(run().returncode, 0)

if __name__ == '__main__':
    unittest.main()
