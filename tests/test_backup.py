import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

scripts = Path(__file__).parents[1] / 'scripts'
sys.path.insert(0, str(scripts))
try:
    spec = importlib.util.spec_from_file_location('backup', scripts / 'backup.py')
    backup = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(backup)
finally:
    sys.path.pop(0)


class VerifiedSetTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.nas = Mock()
        self.nas.upload.side_effect = lambda path, remote: {'file': path.name, 'sha256': 'fixture'}
        # Set-verification behavior has separate real archive/hash tests.
        self.verification = patch.object(backup.verifier, 'verify')
        self.verify = self.verification.start()
        self.addCleanup(self.verification.stop)
        self.readiness = patch.object(backup.snapshot, 'run')
        self.health = self.readiness.start()
        self.addCleanup(self.readiness.stop)

    def test_completion_uploaded_last(self):
        (self.root / 'snapshot.dump').write_bytes(b'fixture')
        events = Mock()
        events.attach_mock(self.verify, 'verify')
        events.attach_mock(self.health, 'health')
        events.attach_mock(self.nas.upload, 'upload')
        backup.verified_copy(self.root, '/remote', self.nas)
        self.assertEqual([call.args[0].name for call in self.nas.upload.call_args_list],
                         ['snapshot.dump', 'COMPLETE.json'])
        self.assertEqual([call[0] for call in events.mock_calls],
                         ['upload', 'verify', 'health', 'upload'])
        self.assertTrue((self.root / 'NAS_VERIFIED').exists())

    def test_payload_failure_never_creates_completion(self):
        (self.root / 'snapshot.dump').write_bytes(b'fixture')
        self.nas.upload.side_effect = RuntimeError('readback mismatch')
        with self.assertRaises(RuntimeError):
            backup.verified_copy(self.root, '/remote', self.nas)
        self.assertFalse((self.root / 'COMPLETE.json').exists())
        self.assertFalse((self.root / 'NAS_VERIFIED').exists())
        self.assertTrue((self.root / 'snapshot.dump').exists())

    def test_completion_upload_failure_is_not_verified(self):
        (self.root / 'snapshot.dump').write_bytes(b'fixture')
        self.nas.upload.side_effect = [{'file': 'snapshot.dump'}, RuntimeError('network failure')]
        with self.assertRaises(RuntimeError):
            backup.verified_copy(self.root, '/remote', self.nas)
        self.assertTrue((self.root / 'COMPLETE.json').exists())
        self.assertFalse((self.root / 'NAS_VERIFIED').exists())

    def test_invalid_set_never_publishes_completion(self):
        (self.root / 'snapshot.dump').write_bytes(b'fixture')
        self.verify.side_effect = ValueError('missing service state')
        with self.assertRaises(ValueError):
            backup.verified_copy(self.root, '/remote', self.nas)
        self.assertEqual(self.nas.upload.call_count, 1)
        self.assertFalse((self.root / 'NAS_VERIFIED').exists())

    def test_failed_service_recovery_never_publishes_completion(self):
        (self.root / 'snapshot.dump').write_bytes(b'fixture')
        self.health.side_effect = RuntimeError('service recovery failed')
        with self.assertRaisesRegex(RuntimeError, 'service recovery failed'):
            backup.verified_copy(self.root, '/remote', self.nas)
        self.health.assert_called_once_with(
            ['/run/current-system/sw/bin/homelab-health'], timeout=150)
        self.assertEqual([call.args[0].name for call in self.nas.upload.call_args_list],
                         ['snapshot.dump'])
        self.assertFalse((self.root / 'NAS_VERIFIED').exists())

    def test_retention_preserves_failed_sets_and_unrelated_paths(self):
        for index in range(4):
            directory = self.root / f'2026110{index + 1}T000000Z-aaaaaaaa'
            directory.mkdir()
            if index != 0:
                (directory / 'NAS_VERIFIED').touch()
        unrelated = self.root / 'notes'
        unrelated.mkdir()
        backup.prune_verified(self.root, 2)
        self.assertTrue((self.root / '20261101T000000Z-aaaaaaaa').exists())
        self.assertFalse((self.root / '20261102T000000Z-aaaaaaaa').exists())
        self.assertTrue((self.root / '20261103T000000Z-aaaaaaaa').exists())
        self.assertTrue((self.root / '20261104T000000Z-aaaaaaaa').exists())
        self.assertTrue(unrelated.exists())

    def test_retention_does_not_follow_directory_symlinks(self):
        outside = self.root / 'outside'
        outside.mkdir()
        (outside / 'NAS_VERIFIED').touch()
        (self.root / '20261101T000000Z-aaaaaaaa').symlink_to(outside)
        backup.prune_verified(self.root, 1)
        self.assertTrue(outside.exists())

    def test_zero_retention_rejected(self):
        with self.assertRaises(ValueError):
            backup.prune_verified(self.root, 0)


class WeeklyRetentionTests(unittest.TestCase):
    def test_only_eight_export_archives_retained_separately(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            import datetime
            for index in range(10):
                date = datetime.datetime(2026, 11, 1, 12) + datetime.timedelta(weeks=index)
                snapshot = root / (date.strftime('%Y%m%dT%H%M%SZ') + '-aaaaaaaa')
                snapshot.mkdir()
                (snapshot / 'NAS_VERIFIED').touch()
                (snapshot / 'hindsight-bank-exports.tar.gz').write_bytes(b'fixture')
                backup.retain_weekly(root, snapshot)
            exports = sorted((root / 'weekly-exports').iterdir())
            self.assertEqual(len(exports), 8)
            self.assertEqual(exports[0].name, '2026-W46.tar.gz')
            self.assertTrue(all(path.stat().st_mode & 0o077 == 0 for path in exports))
            self.assertTrue((root / '20261101T120000Z-aaaaaaaa').exists())

    def test_repeated_exports_in_same_week_preserve_first_verified_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for hour in (12, 13, 14):
                snapshot = root / f'20261101T{hour}0000Z-aaaaaaaa'
                snapshot.mkdir()
                (snapshot / 'NAS_VERIFIED').touch()
                (snapshot / 'hindsight-bank-exports.tar.gz').write_bytes(str(hour).encode())
                backup.retain_weekly(root, snapshot)
            exports = list((root / 'weekly-exports').iterdir())
            self.assertEqual(len(exports), 1)
            self.assertEqual(exports[0].read_bytes(), b'12')

    def test_unverified_export_is_not_retained(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            snapshot = root / '20261101T000000Z-aaaaaaaa'
            snapshot.mkdir()
            with self.assertRaises(ValueError):
                backup.retain_weekly(root, snapshot)
            self.assertFalse(list((root / 'weekly-exports').iterdir()))


if __name__ == '__main__':
    unittest.main()
