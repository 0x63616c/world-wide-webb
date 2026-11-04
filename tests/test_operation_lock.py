import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('operation', Path(__file__).parents[1] / 'scripts/operation-lock.py')
operation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operation)


class OperationLockTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.lock = self.root / 'operation.lock'
        self.lock.touch(mode=0o600)

    def acquire(self):
        return operation.operation_lock(self.root, owner=os.geteuid())

    def test_competing_process_cannot_acquire(self):
        code = '''import fcntl, sys
with open(sys.argv[1], 'r+') as f:
    try:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        sys.exit(75)
'''
        with self.acquire():
            result = subprocess.run([sys.executable, '-c', code, str(self.lock)], timeout=10)
            self.assertEqual(result.returncode, 75)
        result = subprocess.run([sys.executable, '-c', code, str(self.lock)], timeout=10)
        self.assertEqual(result.returncode, 0)

    def test_hold_defers_and_releases_lock(self):
        (self.root / 'hold').touch()
        with self.assertRaises(operation.OperationDeferred):
            with self.acquire():
                self.fail('Must not enter operation')
        (self.root / 'hold').unlink()
        with self.acquire():
            pass

    def test_exception_releases_lock(self):
        with self.assertRaises(ValueError):
            with self.acquire():
                raise ValueError('synthetic operation failure')
        with self.acquire():
            pass

    def test_symlink_lock_rejected(self):
        target = self.root / 'target'
        self.lock.rename(target)
        self.lock.symlink_to(target)
        with self.assertRaises(OSError):
            with self.acquire():
                self.fail('Symlink accepted')

    def test_service_writable_directory_rejected(self):
        self.root.chmod(0o770)
        with self.assertRaises(RuntimeError):
            with self.acquire():
                self.fail('Writable lock directory accepted')

    def test_world_accessible_lock_rejected(self):
        self.lock.chmod(0o666)
        with self.assertRaises(RuntimeError):
            with self.acquire():
                self.fail('World-accessible lock accepted')

    def test_child_can_join_same_lock_without_releasing_parent(self):
        code = '''import importlib.util, os, pathlib, sys
spec = importlib.util.spec_from_file_location('operation', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with module.operation_lock(pathlib.Path(sys.argv[2]), owner=os.geteuid(), inherited_fd=int(sys.argv[3])):
    pass
'''
        with self.acquire() as fd:
            result = subprocess.run([sys.executable, '-c', code, operation.__file__, str(self.root), str(fd)],
                                    pass_fds=(fd,), timeout=10)
            self.assertEqual(result.returncode, 0)
            with self.assertRaises(operation.OperationDeferred):
                with self.acquire():
                    self.fail('Child released parent transaction lock')
        with self.acquire():
            pass

    def test_unrelated_inherited_descriptor_rejected(self):
        other = self.root / 'other'
        other.touch(mode=0o600)
        with other.open('r+') as descriptor:
            with self.assertRaisesRegex(RuntimeError, 'not the host operation lock'):
                with operation.operation_lock(self.root, owner=os.geteuid(), inherited_fd=descriptor.fileno()):
                    self.fail('Wrong descriptor accepted')

    def test_independently_opened_descriptor_cannot_bypass_active_lock(self):
        with self.acquire():
            with self.lock.open('r+') as descriptor:
                with self.assertRaises(operation.OperationDeferred):
                    with operation.operation_lock(self.root, owner=os.geteuid(), inherited_fd=descriptor.fileno()):
                        self.fail('Independent descriptor bypassed parent lock')

    def test_inherited_lock_still_honors_new_maintenance_hold(self):
        with self.acquire() as fd:
            (self.root / 'hold').touch()
            with self.assertRaises(operation.OperationDeferred):
                with operation.operation_lock(self.root, owner=os.geteuid(), inherited_fd=fd):
                    self.fail('Inherited lock bypassed maintenance hold')

    def test_transaction_marker_blocks_new_jobs_but_not_supervised_children(self):
        with self.acquire() as fd:
            (self.root / 'transaction').write_text('{}')
            with operation.operation_lock(self.root, owner=os.geteuid(), inherited_fd=fd):
                pass
        # Simulates loss of the live process lock after reboot/crash.
        with self.assertRaises(operation.OperationDeferred):
            with self.acquire():
                self.fail('Orphaned transaction allowed a scheduled operation')


if __name__ == '__main__':
    unittest.main()
