import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parents[1] / 'scripts' / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


snapshot = load('snapshot', 'snapshot.py')
hindsight = load('hindsight_pg', 'hindsight-pg.py')


class SnapshotSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.destination = Path(self.temporary.name)

    @patch.object(snapshot.time, 'monotonic', side_effect=[0, 241])
    @patch.object(snapshot, 'running_state', return_value={'Running': True, 'Health': None})
    def test_missing_required_health_is_not_success(self, state, clock):
        with self.assertRaisesRegex(RuntimeError, 'did not recover'):
            snapshot.healthy('services', 'bambuddy')

    @patch.object(snapshot, 'running_state', return_value={'Running': True, 'Health': None})
    def test_sidecar_without_docker_health_reaches_later_protocol_gate(self, state):
        snapshot.healthy('services', 'bambuddy-tailscale')

    @patch.object(snapshot.durable, 'sync_directory', side_effect=OSError('sync failed'))
    @patch.object(snapshot, 'run')
    @patch.object(snapshot, 'running_state', return_value={'Running': True})
    def test_unsynced_marker_prevents_stop(self, state, run, sync):
        with self.assertRaisesRegex(OSError, 'sync failed'):
            with snapshot.stopped('services', 'app', self.destination):
                self.fail('Snapshot started without a durable marker')
        run.assert_not_called()
        self.assertTrue((self.destination / 'app.restart-required').exists())

    @patch.object(snapshot, 'healthy')
    @patch.object(snapshot, 'run')
    @patch.object(snapshot, 'running_state', return_value={'Running': True})
    def test_snapshot_failure_restarts_and_checks_health(self, state, run, healthy):
        with self.assertRaisesRegex(RuntimeError, 'disk full'):
            with snapshot.stopped('services', 'app', self.destination):
                self.assertTrue((self.destination / 'app.restart-required').exists())
                raise RuntimeError('disk full')
        self.assertEqual(run.call_args.args[0][-2:], ['start', 'app'])
        healthy.assert_called_once_with('services', 'app')
        self.assertFalse((self.destination / 'app.restart-required').exists())

    @patch.object(snapshot, 'run')
    @patch.object(snapshot, 'running_state', return_value={'Running': False})
    def test_intentionally_stopped_container_is_untouched(self, state, run):
        with self.assertRaises(RuntimeError):
            with snapshot.stopped('services', 'app', self.destination):
                self.fail('Stopped service accepted')
        run.assert_not_called()
        self.assertFalse(list(self.destination.iterdir()))

    @patch.object(snapshot, 'healthy', side_effect=RuntimeError('not healthy'))
    @patch.object(snapshot, 'run')
    @patch.object(snapshot, 'running_state', return_value={'Running': True})
    def test_failed_recovery_retains_restart_marker(self, state, run, healthy):
        with self.assertRaisesRegex(RuntimeError, 'not healthy'):
            with snapshot.stopped('services', 'app', self.destination):
                pass
        self.assertTrue((self.destination / 'app.restart-required').exists())

    @patch.object(snapshot, 'healthy')
    @patch.object(snapshot, 'run', side_effect=[subprocess.TimeoutExpired('stop', 150), None])
    @patch.object(snapshot, 'running_state', return_value={'Running': True})
    def test_stop_timeout_still_attempts_restart(self, state, run, healthy):
        with self.assertRaises(subprocess.TimeoutExpired):
            with snapshot.stopped('services', 'app', self.destination):
                self.fail('Stop timeout accepted')
        self.assertEqual(run.call_args.args[0][-2:], ['start', 'app'])
        healthy.assert_called_once_with('services', 'app')
        self.assertTrue((self.destination / 'app.restart-required').exists())

    def test_hindsight_password_never_enters_command_arguments(self):
        metadata = dict(installation_dir='/postgres', version='16', port=5432,
                        username='hindsight', database='hindsight', password='synthetic-password')
        args = hindsight.command(metadata, 'dump')
        self.assertNotIn('synthetic-password', str(args))
        self.assertEqual(args[0], '/postgres/16/bin/pg_dump')
        self.assertIn('-Fc', args)
        self.assertEqual(hindsight.command(metadata, 'verify'), ['/postgres/16/bin/pg_restore', '-l'])
        with self.assertRaises(ValueError):
            hindsight.command(metadata, 'restore')


class BankExportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.destination = Path(self.temporary.name)

    @patch.object(snapshot, 'run')
    def test_bank_names_are_not_used_as_paths(self, run):
        import json
        from unittest.mock import Mock
        names = ['../outside', 'a/b', 'a_b']
        copies = []
        def execute(args, **kwargs):
            if args[-1] == 'banks':
                return Mock(stdout=json.dumps(names))
            if 'cp' in args:
                target = Path(args[-1])
                copies.append(target.name)
                target.write_bytes(b'zip-fixture')
            return Mock()
        run.side_effect = execute
        snapshot.export_banks(self.destination)
        self.assertEqual(len(set(copies)), 3)
        self.assertTrue(all(len(name) == 68 and '/' not in name for name in copies))
        self.assertFalse((self.destination / 'bank-exports').exists())

    @patch.object(snapshot, 'run')
    def test_failed_export_cleans_remote_temporary_file_and_fails_set(self, run):
        from unittest.mock import Mock
        def execute(args, **kwargs):
            if args[-1] == 'banks':
                return Mock(stdout='["bank"]')
            if 'export-bank' in args:
                raise RuntimeError('export failed')
            return Mock()
        run.side_effect = execute
        with self.assertRaisesRegex(RuntimeError, 'export failed'):
            snapshot.export_banks(self.destination)
        self.assertTrue(any('rm' in call.args[0] for call in run.call_args_list))
        self.assertFalse((self.destination / 'bank-exports').exists())


if __name__ == '__main__':
    unittest.main()
