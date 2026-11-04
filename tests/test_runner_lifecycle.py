import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('lifecycle', Path(__file__).parents[1] / 'scripts/runner-lifecycle.py')
lifecycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lifecycle)


class Backend:
    def __init__(self):
        self.vms = {}
        self.events = []
        self.fail_clone = False
        self.fail_delete = False

    def inventory(self):
        return dict(self.vms)

    def clone(self, image, name, budget):
        self.events.append('clone')
        self.vms[name] = 'stopped'
        if self.fail_clone:
            raise RuntimeError('clone configuration failed')

    def start(self, name):
        self.events.append('start')
        self.vms[name] = 'running'
        return name

    def finish(self, name):
        self.events.append('finish')
        self.vms[name] = 'stopped'

    def stop(self, name):
        self.events.append('stop')
        self.vms[name] = 'stopped'

    def delete(self, name):
        self.events.append('delete')
        if self.fail_delete:
            raise RuntimeError('delete failed')
        del self.vms[name]


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.backend = Backend()
        self.controller = lifecycle.Lifecycle(self.root, self.backend)
        self.admission = dict(host='homelab-macbook', guest='linux', in_flight=0,
                              free_bytes=200 * 1024 ** 3, macos_major=27,
                              tart_version='2.41.1', softnet_version='0.25.0',
                              isolation_verified=True,
                              image='ghcr.io/example/linux@sha256:' + 'a' * 64)

    def test_slot_excludes_another_process(self):
        with self.controller.slot():
            result = subprocess.run(['python3', '-c', '''
import fcntl, os, sys
fd = os.open(sys.argv[1], os.O_RDWR)
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    sys.exit(0)
sys.exit(1)
''', str(self.root / 'slot.lock')], timeout=10)
            self.assertEqual(result.returncode, 0)

    def test_exception_in_job_cleans_vm_before_releasing_slot(self):
        with self.assertRaisesRegex(RuntimeError, 'job failed'):
            with self.controller.guest(**self.admission):
                self.assertTrue(self.controller.journal.exists())
                with self.assertRaises(BlockingIOError):
                    with lifecycle.Lifecycle(self.root, Backend()).slot():
                        self.fail('second slot acquired')
                raise RuntimeError('job failed')
        self.assertEqual(self.backend.events, ['clone', 'start', 'finish', 'delete'])
        self.assertEqual(self.backend.vms, {})
        self.assertFalse(self.controller.journal.exists())

    def test_partial_clone_is_cleaned(self):
        self.backend.fail_clone = True
        with self.assertRaisesRegex(RuntimeError, 'clone configuration'):
            with self.controller.guest(**self.admission):
                self.fail('job started')
        self.assertEqual(self.backend.events, ['clone', 'delete'])
        self.assertFalse(self.controller.journal.exists())

    def test_failed_cleanup_retains_journal_and_blocks_new_job(self):
        self.backend.fail_delete = True
        with self.assertRaisesRegex(RuntimeError, 'delete failed'):
            with self.controller.guest(**self.admission):
                pass
        recorded = self.controller.journal.read_text()
        with self.assertRaisesRegex(RuntimeError, 'delete failed'):
            with self.controller.guest(**self.admission):
                self.fail('new job started')
        self.assertEqual(self.backend.events.count('clone'), 1)
        self.assertEqual(self.controller.journal.read_text(), recorded)

    def test_restart_recovers_journaled_running_guest(self):
        name = 'homelab-job-' + 'b' * 32
        self.controller.record(name)
        self.backend.vms[name] = 'running'
        with self.controller.slot():
            self.assertEqual(self.backend.events, ['stop', 'delete'])
            self.assertFalse(self.controller.journal.exists())

    def test_unknown_vm_is_never_deleted(self):
        self.backend.vms['important-vm'] = 'running'
        with self.assertRaisesRegex(RuntimeError, 'Unjournaled'):
            with self.controller.slot():
                self.fail('slot admitted')
        self.assertEqual(self.backend.events, [])

    def test_bad_journal_cannot_target_arbitrary_vm(self):
        self.controller.journal.write_text(json.dumps({'schema': 1, 'name': '../production'}))
        self.controller.journal.chmod(0o600)
        with self.assertRaises(ValueError):
            with self.controller.slot():
                self.fail('slot admitted')
        self.assertTrue(self.controller.journal.exists())

    def test_ineligible_job_never_creates_guest_or_journal(self):
        with self.assertRaises(ValueError):
            with self.controller.guest(**{**self.admission, 'isolation_verified': False}):
                self.fail('job admitted')
        self.assertEqual(self.backend.events, [])
        self.assertFalse(self.controller.journal.exists())

    def test_shared_state_and_symlink_lock_rejected(self):
        self.root.chmod(0o755)
        with self.assertRaises(ValueError):
            lifecycle.Lifecycle(self.root, self.backend)
        self.root.chmod(0o700)
        (self.root / 'other').touch()
        (self.root / 'slot.lock').symlink_to(self.root / 'other')
        with self.assertRaises(OSError):
            with self.controller.slot():
                self.fail('symlink lock accepted')


if __name__ == '__main__':
    unittest.main()
