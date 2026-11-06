import fcntl
from contextlib import ExitStack
import http.client
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import tunnel_watchdog as watchdog


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.patches = ExitStack()
        self.addCleanup(self.patches.close)
        self.container = watchdog.Container('tunnel-id', 'running', False, 100)
        self.inspect = self.patches.enter_context(patch.object(watchdog, 'inspect_container',
                                                     return_value=self.container))
        self.ready = self.patches.enter_context(patch.object(watchdog, 'tunnel_ready', return_value=False))
        self.restart = self.patches.enter_context(patch.object(watchdog, 'restart_container'))

    def tick(self, now=1000):
        return watchdog.run_once(self.root, now)

    def state(self):
        return json.loads((self.root / 'state.json').read_text())

    def failures(self):
        self.assertEqual(self.tick(1000), 'watch')
        self.assertEqual(self.tick(1030), 'watch')

    def test_restarts_stuck_running_tunnel_after_three_failures(self):
        self.failures()
        self.assertEqual(self.tick(1060), 'restarted')
        self.restart.assert_called_once_with('tunnel-id')
        self.assertEqual(self.state()['last_restart'], 1060)

    def test_single_transient_failure_does_not_restart(self):
        self.tick()
        self.ready.return_value = True
        self.assertEqual(self.tick(1030), 'healthy')
        self.assertEqual(self.state()['failures'], 0)
        self.restart.assert_not_called()

    def test_startup_grace_does_not_count_failures(self):
        self.inspect.return_value = watchdog.Container('tunnel-id', 'running', False, 950)
        self.assertEqual(self.tick(), 'inactive-or-starting')
        self.ready.assert_not_called()
        self.restart.assert_not_called()

    def test_stopped_paused_missing_and_restarting_containers_are_left_alone(self):
        for status, paused in [('exited', False), ('running', True), ('restarting', False)]:
            with self.subTest(status=status, paused=paused):
                self.inspect.return_value = watchdog.Container('tunnel-id', status, paused, 100)
                self.assertEqual(self.tick(), 'inactive-or-starting')
        self.inspect.side_effect = subprocess.CalledProcessError(1, 'docker inspect')
        self.assertEqual(self.tick(), 'docker-unavailable')
        self.ready.assert_not_called()
        self.restart.assert_not_called()

    def test_docker_hang_is_bounded_and_does_not_trigger_container_restart(self):
        self.failures()
        self.inspect.side_effect = subprocess.TimeoutExpired('docker inspect', 10)
        self.assertEqual(self.tick(1060), 'docker-unavailable')
        self.assertEqual(self.state()['failures'], 0)
        self.restart.assert_not_called()

    def test_new_container_or_new_start_time_resets_old_failures(self):
        self.failures()
        self.inspect.return_value = watchdog.Container('replacement-id', 'running', False, 800)
        self.assertEqual(self.tick(1060), 'watch')
        self.inspect.return_value = watchdog.Container('replacement-id', 'running', False, 900)
        self.assertEqual(self.tick(1090), 'watch')
        self.restart.assert_not_called()

    def test_stop_or_replacement_during_probe_prevents_restart(self):
        self.failures()
        for current in [watchdog.Container('tunnel-id', 'exited', False, 100),
                        watchdog.Container('tunnel-id', 'running', True, 100),
                        watchdog.Container('replacement-id', 'running', False, 100)]:
            with self.subTest(current=current):
                watchdog.write_state(self.root / 'state.json', {
                    'version': 1, 'container': self.container.generation,
                    'failures': 2, 'last_restart': 0})
                self.inspect.side_effect = [self.container, current]
                self.assertEqual(self.tick(1060), 'container-changed')
        self.restart.assert_not_called()

    def test_cooldown_survives_a_container_restart(self):
        self.failures()
        self.tick(1060)
        self.inspect.return_value = watchdog.Container('tunnel-id', 'running', False, 1060)
        self.assertEqual(self.tick(1090), 'inactive-or-starting')
        self.tick(1180)
        self.tick(1210)
        self.assertEqual(self.tick(1240), 'cooldown')
        self.assertEqual(self.restart.call_count, 1)
        self.assertEqual(self.tick(1360), 'restarted')
        self.assertEqual(self.restart.call_count, 2)

    def test_failed_restart_persists_cooldown_before_command(self):
        self.failures()
        def fail(identity):
            self.assertEqual(self.state()['last_restart'], 1060)
            raise subprocess.TimeoutExpired('docker restart', 30)
        self.restart.side_effect = fail
        self.assertEqual(self.tick(1060), 'restart-failed')
        self.tick(1090)
        self.tick(1120)
        self.assertEqual(self.tick(1150), 'cooldown')
        self.restart.assert_called_once()

    def test_backwards_clock_starts_bounded_cooldown(self):
        watchdog.write_state(self.root / 'state.json', {
            'version': 1, 'container': self.container.generation,
            'failures': 2, 'last_restart': 2000})
        self.assertEqual(self.tick(1000), 'cooldown')
        self.assertEqual(self.state()['last_restart'], 1000)
        self.assertEqual(self.tick(1300), 'restarted')

    def test_corrupt_state_requires_fresh_failures(self):
        for content in ['broken json', 'null', '{"version": 99}',
                        '{"version":1,"container":"x","failures":-2,"last_restart":0}']:
            with self.subTest(content=content):
                (self.root / 'state.json').write_text(content)
                self.assertEqual(self.tick(), 'watch')
        self.restart.assert_not_called()

    def test_overlapping_invocation_does_nothing(self):
        with (self.root / 'lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(self.tick(), 'already-running')
        self.inspect.assert_not_called()
        self.assertFalse((self.root / 'state.json').exists())


class ProbeTests(unittest.TestCase):
    def test_inspect_only_reads_container_identity_and_lifecycle(self):
        with patch.object(watchdog.subprocess, 'run') as run:
            run.return_value.stdout = ('id running false 2026-11-06T00:32:44.507145029Z\n')
            container = watchdog.inspect_container()
        self.assertEqual(container.status, 'running')
        self.assertFalse(container.paused)
        self.assertAlmostEqual(container.started_at, 1793925164.507145, places=5)
        arguments = run.call_args[0][0]
        self.assertEqual(arguments[:3], watchdog.DOCKER)
        self.assertEqual(arguments[-1], watchdog.CONTAINER)
        self.assertNotIn('.Config', ' '.join(arguments))
        self.assertEqual(run.call_args[1]['timeout'], 10)

    def test_ready_requires_http_200_and_never_follows_redirects(self):
        with patch.object(watchdog.http.client, 'HTTPConnection') as factory:
            connection = factory.return_value
            for status in [200, 301, 302, 503]:
                connection.getresponse.return_value.status = status
                self.assertEqual(watchdog.tunnel_ready(), status == 200)
            factory.assert_called_with('127.0.0.1', 20241, timeout=5)
            connection.request.assert_called_with('GET', '/ready')
            self.assertEqual(connection.close.call_count, 4)

    def test_refused_timed_out_or_malformed_health_response_is_failure(self):
        for error in [ConnectionRefusedError(), TimeoutError(), http.client.BadStatusLine('bad')]:
            with self.subTest(error=error), patch.object(watchdog.http.client, 'HTTPConnection') as factory:
                factory.return_value.getresponse.side_effect = error
                self.assertFalse(watchdog.tunnel_ready())
                factory.return_value.close.assert_called_once()

    def test_restart_is_bounded_and_targets_observed_id(self):
        with patch.object(watchdog.subprocess, 'run') as run:
            watchdog.restart_container('observed-id')
        self.assertEqual(run.call_args[0][0], watchdog.DOCKER + ['restart', '--time', '10', 'observed-id'])
        self.assertEqual(run.call_args[1]['timeout'], 30)


if __name__ == '__main__':
    unittest.main()
