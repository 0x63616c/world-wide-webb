import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import json
import subprocess
import tempfile

spec = importlib.util.spec_from_file_location('update', Path(__file__).parents[1] / 'scripts/update.py')
update = importlib.util.module_from_spec(spec)
spec.loader.exec_module(update)


class DurabilityTests(unittest.TestCase):
    @patch.object(update.durable, 'sync_directory', side_effect=OSError('sync failed'))
    @patch.object(update, 'run')
    def test_unsynced_state_prevents_activation(self, run, sync):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(OSError, 'sync failed'):
                update.activate(root, {}, 'a' * 40, Path('/candidate'), Path('/previous'))
            run.assert_not_called()
            self.assertEqual(json.loads((root / 'status.json').read_text())['result'], 'activating')


class EligibilityTests(unittest.TestCase):
    def run_record(self, **changes):
        return dict(head_sha='a' * 40, head_branch='main', event='push',
                    status='completed', conclusion='success', run_number=1,
                    run_attempt=1, **changes)

    def test_exact_success(self):
        self.assertTrue(update.eligible([self.run_record()], 'a' * 40))

    def test_other_revision_never_authorizes(self):
        self.assertFalse(update.eligible([self.run_record()], 'b' * 40))

    def test_pr_success_never_authorizes(self):
        r = self.run_record(); r['event'] = 'pull_request'
        self.assertFalse(update.eligible([r], 'a' * 40))

    def test_latest_attempt_must_succeed(self):
        r = self.run_record(); r.update(run_attempt=2, status='in_progress', conclusion=None)
        self.assertFalse(update.eligible([self.run_record(), r], 'a' * 40))

    def test_latest_failed_run_overrides_success(self):
        r = self.run_record(); r.update(run_number=2, conclusion='failure')
        self.assertFalse(update.eligible([self.run_record(), r], 'a' * 40))

    def test_empty_is_not_success(self):
        self.assertFalse(update.eligible([], 'a' * 40))


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.old = Path('/nix/store/old-system')
        self.new = Path('/nix/store/new-system')

    def state(self):
        return json.loads((self.root / 'status.json').read_text())

    def activate(self):
        update.activate(self.root, {'deployed': 'old'}, 'new', self.new,
                        self.old, '/etc/homelab/health')

    @patch.object(update, 'run')
    def test_success_records_only_after_health_check(self, run):
        self.activate()
        self.assertEqual(self.state()['deployed'], 'new')
        self.assertEqual(self.state()['result'], 'healthy')
        run.assert_any_call('/etc/homelab/health', timeout=180)
        self.assertFalse((self.root / 'hold').exists())

    @patch.object(update, 'run')
    def test_health_timeout_rolls_back_and_holds(self, run):
        run.side_effect = [None, None, subprocess.TimeoutExpired('health', 180),
                           None, None]
        with self.assertRaises(subprocess.TimeoutExpired):
            self.activate()
        self.assertTrue((self.root / 'hold').exists())
        self.assertEqual(self.state()['deployed'], 'old')
        self.assertEqual(self.state()['failed'], 'new')
        self.assertEqual(self.state()['result'], 'activation-failed-rolled-back')
        self.assertEqual(run.call_args.args, (str(self.old / 'activate'),))

    @patch.object(update, 'run')
    def test_rollback_failure_keeps_hold(self, run):
        run.side_effect = [None, OSError('activation failed'),
                           OSError('rollback failed')]
        with self.assertRaises(OSError):
            self.activate()
        self.assertTrue((self.root / 'hold').exists())
        self.assertEqual(self.state()['result'], 'rollback-failed')
        self.assertEqual(self.state()['deployed'], 'old')

    @patch.object(update, 'run')
    def test_application_failure_never_activates_old_generation(self, run):
        def failed_reconcile():
            raise RuntimeError('possible database migration')
        with self.assertRaises(RuntimeError):
            update.activate(self.root, {'deployed': 'old'}, 'new', self.new, self.old,
                            reconcile=failed_reconcile, health=lambda: None)
        self.assertEqual(run.call_count, 2)
        self.assertEqual(self.state()['result'], 'service-failed-needs-recovery')
        self.assertTrue((self.root / 'hold').exists())
        self.assertEqual(self.state()['currentSystem'], str(self.new))

    def test_interrupted_activation_requires_review(self):
        for result in ('activating', 'rolling-back'):
            with self.subTest(result=result):
                self.assertTrue(update.recover_interrupted(self.root, {
                    'desired': 'new', 'deployed': 'old', 'result': result}))
                self.assertTrue((self.root / 'hold').exists())
                self.assertEqual(self.state()['result'], 'interrupted-needs-review')

    def test_healthy_state_does_not_create_hold(self):
        self.assertFalse(update.recover_interrupted(self.root, {'result': 'healthy'}))
        self.assertFalse((self.root / 'hold').exists())

    def test_credentials_helper_reads_file_and_is_removed(self):
        token = self.root / 'token'
        token.write_text('test-fixture-token\n')
        token.chmod(0o600)
        with update.git_credentials(self.root, token) as env:
            helper = Path(env['GIT_ASKPASS'])
            self.assertNotIn('test-fixture-token', helper.read_text())
            self.assertNotIn('test-fixture-token', str(env))
            self.assertEqual(env['GIT_CONFIG_VALUE_0'], '')
            username = subprocess.check_output([str(helper), 'Username for GitHub:'], env=env)
            password = subprocess.check_output([str(helper), 'Password for GitHub:'], env=env)
            self.assertEqual(username, b'x-access-token\n')
            self.assertEqual(password, b'test-fixture-token\n')
        self.assertFalse(helper.exists())


class DeploymentTransactionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.operation_root = self.root / 'operations'
        self.operation_root.mkdir()
        self.old, self.new = self.root / 'old', self.root / 'new'
        for system in (self.old, self.new):
            (system / 'Library/LaunchDaemons').mkdir(parents=True)
            (system / 'Library/LaunchDaemons/org.homelab.update.plist').write_text('stable supervisor')
            (system / 'etc/homelab').mkdir(parents=True)
            (system / 'etc/homelab/deployment.json').write_text(json.dumps({
                'host': 'homelab-macbook', 'services': ['hindsight'], 'backupsEnabled': True}))
        patcher = patch.object(update.operations, 'operation_lock')
        self.lock = patcher.start()
        self.lock.return_value.__enter__.return_value = 9
        self.addCleanup(patcher.stop)

    def deploy(self):
        update.deployment_transaction(self.root, {'deployed': 'old'}, 'new', self.new,
                                      self.old, self.operation_root)

    @patch.object(update, 'run')
    @patch.object(update.service_child, 'run_service')
    def test_backup_activation_reconcile_health_order(self, service, run):
        events = []
        service.side_effect = lambda name, *args, **kwargs: events.append(name)
        run.side_effect = lambda *args, **kwargs: events.append('activate' if args[0].endswith('/activate') else 'profile')
        self.deploy()
        self.assertEqual(events, ['backup', 'profile', 'activate', 'reconcile', 'health'])
        self.assertEqual(service.call_args_list[0].kwargs['system'], self.old)
        self.assertEqual(service.call_args_list[-1].kwargs['system'], self.new)
        self.assertEqual(json.loads((self.root / 'status.json').read_text())['result'], 'healthy')
        self.assertFalse((self.operation_root / 'transaction').exists())

    @patch.object(update, 'run')
    @patch.object(update.service_child, 'run_service', side_effect=RuntimeError('backup failure'))
    def test_failed_backup_prevents_activation_and_sets_both_holds(self, service, run):
        with self.assertRaises(RuntimeError):
            self.deploy()
        run.assert_not_called()
        self.assertTrue((self.root / 'hold').exists())
        self.assertTrue((self.operation_root / 'hold').exists())
        self.assertTrue((self.operation_root / 'transaction').exists())

    @patch.object(update.service_child, 'run_service')
    def test_service_assignment_change_requires_migration(self, service):
        path = self.new / 'etc/homelab/deployment.json'
        value = json.loads(path.read_text())
        value['services'] = []
        path.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, 'ownership changes'):
            self.deploy()
        service.assert_not_called()
        self.lock.assert_not_called()

    @patch.object(update.service_child, 'run_service')
    def test_stateful_update_requires_backups(self, service):
        path = self.new / 'etc/homelab/deployment.json'
        value = json.loads(path.read_text())
        value['backupsEnabled'] = False
        path.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, 'verified backups'):
            self.deploy()
        service.assert_not_called()

    @patch.object(update.service_child, 'run_service')
    def test_updater_plist_changes_never_activate(self, service):
        (self.new / 'Library/LaunchDaemons/org.homelab.update.plist').write_text('changed supervisor')
        with self.assertRaisesRegex(ValueError, 'supervision changes'):
            self.deploy()
        service.assert_not_called()
        self.lock.assert_not_called()


if __name__ == '__main__':
    unittest.main()
