"""A guest marked Running must not turn a failed boot into successful startup."""
import importlib.util
import subprocess
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


if __name__ == '__main__':
    unittest.main()
