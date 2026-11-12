"""A guest marked Running must not turn a failed boot into successful startup."""
import importlib.util
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location('colima_start', Path(__file__).parents[1] / 'scripts/colima-start.py')
startup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(startup)


class ColimaStartupTests(unittest.TestCase):
    def exercise(self, *, docker, ssh=False, lock=None, budget=0, clock=None, child_running=False, stop=True):
        child = Mock()
        child.poll.return_value = None if child_running else 0
        child.wait.return_value = 0
        docker = iter(docker)
        calls = []

        def run(command, **kwargs):
            calls.append((command[3:], kwargs))
            if command[3:] == ['docker', 'info']:
                ok = next(docker)
            elif command[3:5] == ['colima', 'ssh']:
                ok = ssh
            else:
                self.assertEqual(command[3:], ['colima', 'stop', '--profile', 'services', '--force'])
                ok = stop
            self.assertEqual(command[:2], ['timeout', '--signal=KILL'])
            return subprocess.CompletedProcess(command, 0 if ok else 1)

        @contextmanager
        def default_lock():
            yield 9

        with patch.object(startup.subprocess, 'Popen', return_value=child) as spawn, \
                patch.object(startup.subprocess, 'run', side_effect=run), \
                patch.object(startup, 'STARTUP_SECONDS', budget), \
                patch.object(startup, 'recovery_lock', lock or default_lock), \
                patch.object(startup.time, 'monotonic', side_effect=clock, return_value=0), \
                patch.object(startup.time, 'sleep'):
            result = startup.supervise(['--memory', '4'])
        self.assertEqual(spawn.call_args.args[0], [
            'colima', 'start', '--profile', 'services', '--foreground', '--memory', '4',
        ])
        return result, calls, child

    def test_already_running_but_unreachable_guest_is_recovered(self):
        result, calls, _ = self.exercise(docker=[False, False])
        self.assertEqual(result, 1, 'A failed guest boot must ask launchd to retry')
        self.assertEqual(calls[-1][0], ['colima', 'stop', '--profile', 'services', '--force'])
        self.assertEqual(calls[-1][1]['pass_fds'], (9,), 'Stop must retain the operation lock')

    def test_healthy_start_and_slow_normal_boot_never_stop_vm(self):
        for readiness in ([True], [False, True]):
            with self.subTest(readiness=readiness):
                result, calls, child = self.exercise(docker=readiness, budget=180)
                self.assertEqual(result, 0)
                self.assertTrue(all(command == ['docker', 'info'] for command, _ in calls))
                child.terminate.assert_not_called()
                child.wait.assert_called_once_with()

    def test_guest_with_working_ssh_is_left_running_when_docker_fails(self):
        result, calls, child = self.exercise(docker=[False, False, True], ssh=True)
        self.assertEqual(result, 0)
        self.assertEqual([command[:2] for command, _ in calls], [
            ['docker', 'info'], ['docker', 'info'], ['colima', 'ssh'], ['docker', 'info'],
        ])
        child.terminate.assert_not_called()

    def test_readiness_is_rechecked_after_acquiring_operation_lock(self):
        result, calls, _ = self.exercise(docker=[False, True])
        self.assertEqual(result, 0)
        self.assertEqual(len(calls), 2)

    def test_busy_operation_and_maintenance_hold_defer_recovery(self):
        for reason in ('Another stateful operation is running', 'Maintenance hold is set'):
            @contextmanager
            def deferred():
                raise startup.operation.OperationDeferred(reason)
                yield  # pragma: no cover

            with self.subTest(reason=reason):
                result, calls, child = self.exercise(docker=[False, True], lock=deferred)
                self.assertEqual(result, 0)
                self.assertTrue(all(command == ['docker', 'info'] for command, _ in calls))
                child.terminate.assert_not_called()

    def test_inflight_start_is_terminated_only_for_locked_recovery(self):
        result, _, child = self.exercise(docker=[False, False], child_running=True, stop=False)
        self.assertEqual(result, 1, 'Failed recovery must remain a launchd failure')
        child.terminate.assert_called_once_with()
        child.wait.assert_called_once_with(timeout=5)


class ColimaSignalTests(unittest.TestCase):
    def test_service_stop_reaches_colima_and_reaps_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fake = root / 'colima'
            fake.write_text('#!' + sys.executable + '\n' + '''import os, signal, sys, time
from pathlib import Path
root = Path(os.environ['SIGNAL_FIXTURE'])
def stop(signum, frame):
    (root / 'stopped').write_text(str(signum))
    raise SystemExit(0)
signal.signal(signal.SIGTERM, stop)
(root / 'ready.tmp').write_text(str(os.getpid()))
(root / 'ready.tmp').rename(root / 'ready')
while True:
    time.sleep(0.05)
''')
            fake.chmod(0o700)
            driver = '''import importlib.util, sys
spec = importlib.util.spec_from_file_location('startup', sys.argv[1])
startup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(startup)
startup.run = lambda *args, **kwargs: True
raise SystemExit(startup.supervise([]))
'''
            parent = subprocess.Popen([sys.executable, '-c', driver, str(Path(startup.__file__))],
                env=dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'], SIGNAL_FIXTURE=str(root)),
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            child_pid = None
            try:
                deadline = time.monotonic() + 5
                while not (root / 'ready').exists():
                    if parent.poll() is not None or time.monotonic() >= deadline:
                        self.fail('Fake Colima did not start')
                    time.sleep(0.01)
                child_pid = int((root / 'ready').read_text())
                parent.send_signal(signal.SIGTERM)
                parent.wait(timeout=6)
                self.assertTrue((root / 'stopped').exists(), 'Service stop must reach foreground Colima')
                self.assertEqual((root / 'stopped').read_text(), str(int(signal.SIGTERM)))
                self.assertEqual(parent.returncode, 128 + signal.SIGTERM)
            finally:
                if parent.poll() is None:
                    parent.kill()
                    parent.wait()
                if child_pid and not (root / 'stopped').exists():
                    try:
                        os.kill(child_pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass

if __name__ == '__main__':
    unittest.main()
