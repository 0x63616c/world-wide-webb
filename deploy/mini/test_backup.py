"""Failure-path safety checks; run with python3 -m unittest discover -s deploy/mini."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock, patch


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


backup = load('backup', 'backup.py')
upload = load('nas_upload', 'nas-upload.py')


class BackupSafety(unittest.TestCase):
    def test_snapshot_failure_still_restarts_service(self):
        with patch.object(backup.subprocess, 'check_output', return_value='true'), patch.object(backup, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'disk full'):
                with backup.stopped('orbstack', 'service'):
                    raise RuntimeError('disk full')
            self.assertEqual(run.call_args_list[-1].args[0][-2:], ['start', 'service'])

    def test_does_not_start_a_previously_stopped_service(self):
        with patch.object(backup.subprocess, 'check_output', return_value='false'), patch.object(backup, 'run') as run:
            with self.assertRaises(RuntimeError):
                with backup.stopped('orbstack', 'service'):
                    self.fail('must not enter snapshot')
            run.assert_not_called()

    def test_wrong_nas_certificate_sends_no_credentials(self):
        connection = Mock()
        connection.sock.getpeercert.return_value = b'unexpected certificate'
        config = dict(host='nas.test', certificate_sha256='0' * 64,
                      username='test-user', password='test-value')
        with patch.object(upload.http.client, 'HTTPSConnection', return_value=connection):
            with self.assertRaisesRegex(RuntimeError, 'pin mismatch'):
                upload.Nas(config).login()
        connection.request.assert_not_called()
        connection.send.assert_not_called()
        connection.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
