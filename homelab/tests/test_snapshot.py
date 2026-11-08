import importlib.util
from pathlib import Path
import subprocess
import sys
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

    def test_running_state_captures_real_process_output_without_stderr_conflict(self):
        command = [sys.executable, '-c',
                   'import json,sys; print(json.dumps({"Running": True, "Health": None})); '
                   'print("diagnostic fixture", file=sys.stderr)']
        with patch.object(snapshot, 'docker', return_value=command):
            self.assertEqual(snapshot.running_state('services', 'fixture'),
                             {'Running': True, 'Health': None})

    def test_non_capture_process_still_suppresses_stderr_by_default(self):
        result = snapshot.run([sys.executable, '-c',
                               'import sys; print("diagnostic fixture", file=sys.stderr)'])
        self.assertIsNone(result.stderr)

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

    @patch.object(snapshot, 'healthy')
    @patch.object(snapshot, 'container_files')
    @patch.object(snapshot, 'run')
    @patch.object(snapshot, 'running_state', return_value={'Running': True})
    def test_beszel_data_is_copied_only_while_stopped_and_restarted_after_failure(self, state, run, files, healthy):
        from unittest.mock import Mock
        def execute(args, **kwargs):
            return Mock(stdout='[]' if 'image' in args else 'sha256:fixture')
        run.side_effect = execute
        def copy(destination, runtime, name, path):
            self.assertEqual((runtime, name, path), ('services', 'beszel-beszel-1', '/beszel_data'))
            self.assertEqual(destination, self.destination / 'beszel-data.tar.gz')
            self.assertEqual(run.call_args.args[0][-4:], ['stop', '--time', '120', name])
            raise OSError('fixture copy failure')
        files.side_effect = copy
        with self.assertRaisesRegex(OSError, 'fixture copy failure'):
            snapshot.snapshot(self.destination, ['beszel'])
        self.assertEqual(run.call_args.args[0][-2:], ['start', 'beszel-beszel-1'])
        healthy.assert_called_once_with('services', 'beszel-beszel-1')
        self.assertFalse(list(self.destination.glob('*.restart-required')))

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

class OnlineSnapshotTests(unittest.TestCase):
    def setUp(self):
        import sqlite3
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root/'source.sqlite'
        with sqlite3.connect(self.source) as db:
            db.execute('CREATE TABLE records(id INTEGER PRIMARY KEY, value TEXT)')
            db.execute('INSERT INTO records VALUES(1, ?)', ('restored ✓',))
        self.destination = self.root/'set';self.destination.mkdir(mode=0o700)
        self.commands=[]
        self.failure=None

    def execute(self,args,**kwargs):
        import json,shutil
        from unittest.mock import Mock
        self.commands.append(args)
        if '{{json .Mounts}}' in args:
            return Mock(stdout=json.dumps([{'Destination':'/app/data','Type':'volume','Name':'sqlite'}]))
        if 'volume' in args and 'inspect' in args:
            return Mock(stdout=json.dumps([{'Driver':'local','Options':{}}]))
        if self.failure and self.failure in args:
            raise subprocess.TimeoutExpired(self.failure,10)
        if 'cp' in args:shutil.copyfile(self.source,args[-1])
        return Mock()

    @patch.object(snapshot,'container_files')
    @patch.object(snapshot,'running_state',return_value={'Running':True})
    def test_hourly_keeps_writer_running_and_restores_consistent_database(self,state,files):
        import sqlite3,re
        with patch.object(snapshot,'run',side_effect=self.execute):
            snapshot.online_control_center(self.destination)
        with sqlite3.connect(self.destination/'control-center.sqlite') as db:
            self.assertEqual(db.execute('SELECT value FROM records').fetchone(),('restored ✓',))
        self.assertFalse(any('stop' in c or 'start' in c for c in self.commands))
        command=next(c for c in self.commands if 'database-snapshot' in c)
        self.assertRegex(command[-1],r'^/app/data/\.hourly-\d{8}T\d{6}Z\.sqlite$')
        self.assertTrue(any('rm' in c and '--' in c for c in self.commands))
        self.assertFalse(list(self.destination.glob('*.online-snapshot-pending')))
        files.assert_called_once_with(self.destination/'control-center-media.tar.gz','services','www-control-center-www-1','/app/media')

    @patch.object(snapshot,'running_state',return_value={'Running':True})
    def test_copy_failure_cleans_owned_remote_file_without_restarting_writer(self,state):
        self.failure='cp'
        with patch.object(snapshot,'run',side_effect=self.execute):
            with self.assertRaises(subprocess.TimeoutExpired):snapshot.online_control_center(self.destination)
        self.assertTrue(any('rm' in c for c in self.commands))
        self.assertFalse(any('stop' in c or 'start' in c for c in self.commands))
        self.assertFalse(list(self.destination.glob('*.online-snapshot-pending')))

    @patch.object(snapshot,'running_state',return_value={'Running':True})
    def test_uncertain_native_snapshot_retains_marker_and_does_not_delete_unowned_output(self,state):
        self.failure='database-snapshot'
        with patch.object(snapshot,'run',side_effect=self.execute):
            with self.assertRaises(subprocess.TimeoutExpired):snapshot.online_control_center(self.destination)
        self.assertFalse(any('rm' in c for c in self.commands))
        self.assertTrue(list(self.destination.glob('*.online-snapshot-pending')))

    @patch.object(snapshot,'running_state',return_value={'Running':True})
    def test_preexisting_output_never_deleted(self,state):
        self.failure='test'
        with patch.object(snapshot,'run',side_effect=self.execute):
            with self.assertRaises(subprocess.TimeoutExpired):snapshot.online_control_center(self.destination)
        self.assertFalse(any('rm' in c or 'database-snapshot' in c for c in self.commands))
        self.assertFalse(list(self.destination.glob('*.online-snapshot-pending')))

    @patch.object(snapshot,'running_state',return_value={'Running':True})
    def test_network_volume_is_rejected_before_native_snapshot(self,state):
        from unittest.mock import Mock
        import json
        def execute(args,**kwargs):
            if 'volume' in args and 'inspect' in args:
                return Mock(stdout=json.dumps([{'Driver':'local','Options':{'type':'nfs'}}]))
            return self.execute(args,**kwargs)
        with patch.object(snapshot,'run',side_effect=execute):
            with self.assertRaisesRegex(RuntimeError,'Network-backed'):snapshot.online_control_center(self.destination)
        self.assertFalse(any('database-snapshot' in c for c in self.commands))


if __name__ == '__main__':
    unittest.main()
