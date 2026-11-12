#!/usr/bin/env python3
"""Local-only Worker configuration checks; never accesses a provider."""
import json
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent

class ConfigurationTests(unittest.TestCase):
    def test_configuration_preserves_resources_and_requires_valid_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = pathlib.Path(tmp)
            bindings = dict(environment='production', api_origin='https://api.getfolding.app',
                admin_origin='https://admin.getfolding.app', access_audience='audience',
                worker_name='test', account_id='test', database_id='test', database_name='test',
                avatar_bucket='test', jobs_queue='test', dead_queue='test-dead')
            configuration = dict(APPLE_SIGN_IN_TEAM_ID='TEAM123456', APPLE_SIGN_IN_KEY_ID='KEY1234567',
                APP_ATTEST_ENVIRONMENT='production', APP_ATTEST_BUNDLE_VERSIONS='["1"]',
                ACCESS_TEAM_DOMAIN='https://test.cloudflareaccess.com', WORKER_VERSION='a'*40,
                ADMIN_EMAIL_ALLOWLIST='["test@example.com"]', APNS_KEY_ID='KEY1234567')
            config = directory / 'configuration.json'
            config.write_text(json.dumps(configuration))
            output = directory / 'worker.json'
            command = ['python3', str(ROOT/'scripts/generate-worker-config.py'), '--configuration', str(config), '--output', str(output)]
            def run():
                return subprocess.run(command, input=json.dumps(bindings), text=True, capture_output=True)
            self.assertEqual(run().returncode, 0)
            generated = json.loads(output.read_text())
            for name in ('APNS_ENABLED', 'AVATAR_UPLOADS_ENABLED', 'ADMIN_EMAIL_ENABLED', 'VERIFIED_CAPABILITIES'):
                self.assertNotIn(name, generated['vars'])
            self.assertEqual(generated['limits']['cpu_ms'], 5000)
            self.assertNotIn('MINIMUM_IOS_BUILD', generated['vars'])
            self.assertEqual(generated['observability']['head_sampling_rate'], 0.1)
            self.assertFalse(generated['observability']['logs']['invocation_logs'])
            self.assertEqual([r['simple']['limit'] for r in generated['ratelimits']], [600,60,120])
            self.assertEqual(len({r['namespace_id'] for r in generated['ratelimits']}),3)
            self.assertEqual(generated['queues']['consumers'][0]['max_batch_size'],10)
            configuration['MINIMUM_IOS_BUILD'] = '10'
            config.write_text(json.dumps(configuration))
            self.assertNotEqual(run().returncode, 0)
            configuration['MINIMUM_IOS_BUILD'] = '-1'
            config.write_text(json.dumps(configuration))
            self.assertNotEqual(run().returncode, 0)
            configuration.pop('MINIMUM_IOS_BUILD')
            config.write_text(json.dumps(configuration))
            self.assertEqual(run().returncode, 0)
            self.assertEqual(json.loads(output.read_text())['vars']['WORKER_VERSION'], 'a'*40)
            configuration['WORKER_VERSION'] = 'bad-source'
            config.write_text(json.dumps(configuration))
            self.assertNotEqual(run().returncode, 0)

if __name__ == '__main__':
    unittest.main()
