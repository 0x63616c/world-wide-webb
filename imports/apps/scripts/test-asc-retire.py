#!/usr/bin/env python3
"""Retirement scope and mutation regressions without credentials or Apple access."""
import base64
import importlib.util
import sys
import io
from contextlib import redirect_stdout
from pathlib import Path
import unittest

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('retire', Path(__file__).with_name('asc-retire.py'))
retire = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retire)


def resource(kind, record_id, **attributes):
    return {'id': record_id, 'type': kind, 'attributes': attributes}


class FakeClient:
    def __init__(self, fail=False):
        self.actions = []
        self.fail = fail

    def list(self, path, **params):
        root = retire.ROOTS[0]
        if path == '/v1/apps':
            return [resource('apps', 'app', bundleId=root, name='Retired app')] if params['filter[bundleId]'] == root else []
        if path == '/v1/bundleIds':
            return [resource('bundleIds', 'root', identifier=root, platform='IOS'),
                    resource('bundleIds', 'child', identifier=root + '.Widget', platform='IOS'),
                    resource('bundleIds', 'protected', identifier='com.calumwebb.still', platform='IOS')]
        if path.endswith('/appStoreVersions'):
            return [resource('appStoreVersions', 'version', versionString='1.0', appStoreState='READY_FOR_SALE')]
        if path == '/v1/builds':
            return [resource('builds', 'active', expired=False), resource('builds', 'expired', expired=True)]
        if path.endswith('/betaGroups'):
            return [resource('betaGroups', 'group', name='Internal')]
        if path.endswith('/relationships/betaTesters'):
            return [{'id': 'tester', 'type': 'betaTesters'}]
        if path.endswith('/profiles'):
            return [resource('profiles', path.split('/')[3] + '-profile', name='Profile', profileState='ACTIVE')]
        raise AssertionError(path)

    def request(self, method, path, body=None):
        self.actions.append((method, path, body))
        if self.fail:
            raise retire.APIError('HTTP 409: attached to app record')
        return {}


class GuardTests(unittest.TestCase):
    def test_guard(self):
        for root in retire.ROOTS:
            for identifier in (root, root + '.Widget', root + '.a.b'):
                self.assertEqual(retire.guard(identifier), identifier)
            for suffix in ('evil', '.', '..Widget', '.Widget/else'):
                with self.assertRaises(ValueError):
                    retire.guard(root + suffix)
        for identifier in ('com.calumwebb.tendr', 'com.calumwebb.still', 'random', '', None, 'com.calumwebb.tendr.Widget'):
            with self.assertRaises(ValueError):
                retire.guard(identifier)

    def run_mode(self, mode, fail=False):
        client = FakeClient(fail)
        worker = retire.Retirement(client)
        with redirect_stdout(io.StringIO()):
            status = worker.run(mode)
        return client.actions, status, worker.lines

    def test_report_is_read_only(self):
        actions, status, lines = self.run_mode('report')
        self.assertEqual((actions, status), ([], 0))
        self.assertIn('READY_FOR_SALE', '\n'.join(lines))
        self.assertNotIn('protected', '\n'.join(lines))

    def test_retire_expires_only_active_builds_and_deletes_profiles(self):
        actions, status, _ = self.run_mode('retire')
        self.assertEqual(status, 0)
        self.assertEqual([(m, p) for m, p, _ in actions], [
            ('PATCH', '/v1/builds/active'), ('DELETE', '/v1/profiles/root-profile'), ('DELETE', '/v1/profiles/child-profile')])
        self.assertTrue(actions[0][2]['data']['attributes']['expired'])

    def test_delete_children_first_and_continue_after_errors(self):
        actions, status, lines = self.run_mode('delete-ids', fail=True)
        self.assertEqual(status, 1)
        self.assertEqual([p for _, p, _ in actions], ['/v1/bundleIds/child', '/v1/bundleIds/root'])
        self.assertIn('HTTP 409', '\n'.join(lines))

    def test_discovery_failure_prevents_mutations(self):
        client = FakeClient()
        client.list = lambda *args, **kwargs: (_ for _ in ()).throw(retire.APIError('HTTP 403'))
        with redirect_stdout(io.StringIO()):
            self.assertEqual(retire.Retirement(client).run('retire'), 1)
        self.assertEqual(client.actions, [])

    def test_key_formats_and_email_redaction(self):
        pem = '-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----'
        self.assertEqual(retire.private_key(pem), pem)
        encoded = base64.b64encode(pem.encode()).decode()
        self.assertEqual(retire.private_key(encoded[:20] + '\n' + encoded[20:]), pem)
        self.assertNotIn('tester@example.invalid', retire.safe('tester@example.invalid'))

    def test_all_response_pages_are_followed(self):
        client = retire.Client()
        calls = []
        def request(method, path, body=None):
            calls.append(path)
            return {'data': [{'id': str(len(calls))}],
                    'links': {'next': retire.API + '/v1/bundleIds?cursor=next' if len(calls) == 1 else None}}
        client.request = request
        self.assertEqual(len(client.list('/v1/bundleIds')), 2)
        self.assertEqual(len(calls), 2)

    def test_direct_mutation_guard(self):
        client = FakeClient()
        with self.assertRaises(ValueError):
            retire.Retirement(client).action('com.calumwebb.tendr', 'DELETE', '/v1/bundleIds/protected')
        self.assertEqual(client.actions, [])


if __name__ == '__main__':
    unittest.main()
