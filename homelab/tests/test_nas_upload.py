"""NAS protocol safety tests imported from world-wide-webb, with host namespace checks."""
import hashlib
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parents[1] / 'scripts' / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


upload = load('nas_upload', 'nas-upload.py')


class BackupSafety(unittest.TestCase):
    def test_per_file_missing_response_uploads_instead_of_downloading(self):
        nas = upload.Nas({})
        path = Path('backup.dump')
        # Actual DSM getinfo shape: outer success, per-file absence.
        with patch.object(nas, 'call', return_value={'files': [{'path': '/destination/backup.dump', 'code': 408}]}), patch.object(nas, 'upload', return_value={'sha256': 'abc', 'bytes': 3}) as send, patch.object(nas, 'download_hash') as download:
            nas.ensure_file(path, '/destination', 'abc', 3)
        send.assert_called_once_with(path, '/destination')
        download.assert_not_called()

    def test_per_file_permission_error_does_not_upload_or_download(self):
        nas = upload.Nas({})
        with patch.object(nas, 'call', return_value={'files': [{'code': 407}]}), patch.object(nas, 'upload') as send, patch.object(nas, 'download_hash') as download:
            with self.assertRaises(upload.NasApiError) as raised:
                nas.ensure_file(Path('backup.dump'), '/destination', 'abc', 3)
        self.assertEqual(raised.exception.code, 407)
        send.assert_not_called()
        download.assert_not_called()

    def test_existing_file_requires_matching_bytes_without_overwrite(self):
        nas = upload.Nas({})
        for actual in [('abc', 3), ('different', 3), ('abc', 4)]:
            with self.subTest(actual=actual), patch.object(nas, 'call', return_value={'files': [{'path': '/destination/backup.dump', 'isdir': False}]}), patch.object(nas, 'download_hash', return_value=actual), patch.object(nas, 'upload') as send:
                if actual == ('abc', 3):
                    nas.ensure_file(Path('backup.dump'), '/destination', 'abc', 3)
                else:
                    with self.assertRaisesRegex(RuntimeError, 'refusing overwrite'):
                        nas.ensure_file(Path('backup.dump'), '/destination', 'abc', 3)
                send.assert_not_called()

    def test_expired_upload_session_refreshes_once(self):
        nas = upload.Nas({})
        with patch.object(nas, '_upload', side_effect=[upload.NasApiError('upload', 119), {'verified': True}]) as send, patch.object(nas, 'login') as login:
            self.assertEqual(nas.upload(Path('backup.dump'), '/destination'), {'verified': True})
        login.assert_called_once()
        self.assertEqual(send.call_count, 2)

    def test_repeated_session_rejection_stops_after_one_refresh(self):
        nas = upload.Nas({})
        with patch.object(nas, '_upload', side_effect=upload.NasApiError('upload', 119)) as send, patch.object(nas, 'login') as login:
            with self.assertRaises(upload.NasApiError):
                nas.upload(Path('backup.dump'), '/destination')
        login.assert_called_once()
        self.assertEqual(send.call_count, 2)

    def test_other_upload_errors_are_not_replayed(self):
        nas = upload.Nas({})
        with patch.object(nas, '_upload', side_effect=upload.NasApiError('upload', 414)) as send, patch.object(nas, 'login') as login:
            with self.assertRaises(upload.NasApiError):
                nas.upload(Path('backup.dump'), '/destination')
        login.assert_not_called()
        send.assert_called_once()

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

    def test_host_namespaces_are_separate_and_bounded(self):
        for host in ('mac-mini', 'homelab-mac-mini', 'homelab-macbook'):
            self.assertTrue(upload.valid_destination('/Homelab/backups/' + host + '/20261103T000000Z'))
        for destination in ('/Homelab/backups/other/x', '/Homelab/backups/homelab-macbook/../x',
                            '/Homelab/backups/homelab-macbook/', '/Homelab/backups/homelab-macbook/a/b'):
            self.assertFalse(upload.valid_destination(destination))

    def test_scoped_destinations_are_only_new_host_history_or_penpot_snapshots(self):
        stamp='20261108T000000Z-aaaaaaaa'
        for host in ['homelab-macbook','homelab-mac-mini']:
            for scope in ['control-center-history','penpot']:
                self.assertTrue(upload.valid_destination('/Homelab/backups/'+host+'/'+scope+'/'+stamp))
        for path in ['/Homelab/backups/mac-mini/control-center-history/'+stamp,
                     '/Homelab/backups/homelab-macbook/other/'+stamp,
                     '/Homelab/backups/homelab-macbook/control-center-history/../'+stamp,
                     '/Homelab/backups/homelab-macbook/penpot/not-a-stamp']:
            self.assertFalse(upload.valid_destination(path))

    def test_uploaded_payload_must_match_download_hash_and_size(self):
        payload = b'synthetic snapshot'
        expected = hashlib.sha256(payload).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'backup.dump'
            path.write_bytes(payload)
            for checksum, size in ((expected, len(payload)), ('0' * 64, len(payload)),
                                   (expected, len(payload) + 1)):
                with self.subTest(checksum=checksum, size=size):
                    connection = Mock()
                    response = connection.getresponse.return_value
                    response.status = 200
                    response.read.return_value = b'{"success":true}'
                    nas = upload.Nas({})
                    nas.sid = 'synthetic-session'
                    with patch.object(nas, 'connect', return_value=connection), patch.object(
                            nas, 'download_hash', return_value=(checksum, size)):
                        if checksum == expected and size == len(payload):
                            result = nas._upload(path, '/destination')
                            self.assertEqual(result['sha256'], expected)
                            self.assertEqual(result['bytes'], len(payload))
                        else:
                            with self.assertRaisesRegex(RuntimeError, 'read-back'):
                                nas._upload(path, '/destination')
                    prefix = connection.send.call_args_list[0].args[0]
                    self.assertNotIn(b'overwrite', prefix)


if __name__ == '__main__':
    unittest.main()
