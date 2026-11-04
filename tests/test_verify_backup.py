import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('verify_backup', Path(__file__).parents[1] / 'scripts/verify-backup.py')
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


class RestoreVerificationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.host = {'host': 'homelab-macbook', 'services': ['cloudflared']}
        self.images()
        self.archive()
        self.manifest()

    def images(self):
        containers = {
            'cloudflared': ['www-tunnel-cloudflared-1'],
            'home-assistant': ['www-home-assistant-home-assistant-1'],
            'control-center': ['www-control-center-www-1', 'www-control-center-postgres-1'],
            'bambuddy': ['bambuddy', 'bambu-studio-api', 'bambuddy-tailscale'],
            'hindsight': ['hindsight'],
        }
        images = {name: {'id': 'sha256:' + 'a' * 64,
                         'repo_digests': ['example/image@sha256:' + 'b' * 64]}
                  for service in self.host['services'] for name in containers[service]}
        (self.root / 'images.json').write_text(json.dumps(images))

    def archive(self, extra=None, omit=None, empty=None):
        files = {'host.json': json.dumps(self.host).encode()}
        for service in self.host['services']:
            files['compose/' + service + '/compose.yaml'] = b'fixture compose'
        credentials = {
            'cloudflared': ['TUNNEL_TOKEN'],
            'hindsight': ['environment'],
            'bambuddy': ['environment', 'serve.json'],
            'control-center': ['POSTGRES_PASSWORD', 'HA_TOKEN', 'ALARM_API_TOKEN',
                               'HOME_LAT', 'HOME_LON', 'WIFI_GUEST_SSID', 'WIFI_GUEST_PASSWORD'],
            'home-assistant': [],
        }
        for service in self.host['services']:
            for name in credentials[service]:
                files['credentials/' + service + '/' + name] = b'fixture credential'
        if any(service != 'home-assistant' for service in self.host['services']):
            files['containers.env'] = b'fixture environment'
        if 'control-center' in self.host['services']:
            files['compose/control-center/release.json'] = b'fixture release'
        if 'bambuddy' in self.host['services']:
            files['compose/bambuddy/tailscale/serve.json'] = b'fixture serve config'
        if omit:
            files.pop(omit)
        if empty:
            files[empty] = b''
        with tarfile.open(self.root / 'recovery.tar.gz', 'w:gz') as archive:
            for name, data in files.items():
                member = tarfile.TarInfo('./' + name)
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
            if extra:
                archive.addfile(extra)

    def manifest(self):
        records = []
        for path in sorted(self.root.iterdir()):
            if path.name == 'COMPLETE.json':
                continue
            name = path.name
            data = path.read_bytes()
            records.append({'file': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        (self.root / 'COMPLETE.json').write_text(json.dumps({'format': 1, 'files': records}))

    def test_valid_set_needs_no_local_upload_marker(self):
        self.assertEqual(verify.verify(self.root), self.host)
        self.assertFalse((self.root / 'NAS_VERIFIED').exists())

    def test_same_size_corruption_is_rejected(self):
        data = (self.root / 'images.json').read_bytes()
        (self.root / 'images.json').write_bytes(b'X' + data[1:])
        with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
            verify.verify(self.root)

    def test_missing_payload_rejected(self):
        (self.root / 'images.json').unlink()
        with self.assertRaises(ValueError):
            verify.verify(self.root)

    def test_unlisted_payload_rejected(self):
        (self.root / 'extra').touch()
        with self.assertRaisesRegex(ValueError, 'unlisted'):
            verify.verify(self.root)

    def test_manifest_path_traversal_rejected(self):
        path = self.root / 'COMPLETE.json'
        data = json.loads(path.read_text())
        data['files'][0]['file'] = '../outside'
        path.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, 'filename'):
            verify.verify(self.root)

    def test_recovery_archive_links_and_traversal_rejected(self):
        for name, kind in (('../outside', tarfile.REGTYPE), ('linked', tarfile.SYMTYPE)):
            with self.subTest(name=name):
                member = tarfile.TarInfo(name)
                member.type = kind
                member.linkname = '/etc/passwd' if kind == tarfile.SYMTYPE else ''
                self.archive(member)
                self.manifest()
                with self.assertRaisesRegex(ValueError, 'Unsafe'):
                    verify.verify(self.root)

    def test_missing_service_state_rejected_despite_valid_hashes(self):
        self.host['services'] = ['home-assistant']
        self.images()
        self.archive()
        self.manifest()
        with self.assertRaisesRegex(ValueError, 'service assignment'):
            verify.verify(self.root)

    def test_duplicate_payload_record_rejected(self):
        path = self.root / 'COMPLETE.json'
        data = json.loads(path.read_text())
        data['files'].append(data['files'][0])
        path.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            verify.verify(self.root)

    def test_home_assistant_only_needs_no_general_runtime_credentials(self):
        self.host['services'] = ['home-assistant']
        self.images()
        self.archive()
        (self.root / 'home-assistant-config.tar.gz').write_bytes(b'fixture archive')
        self.manifest()
        self.assertEqual(verify.verify(self.root), self.host)

    def test_empty_payload_rejected_even_with_matching_checksum(self):
        self.host['services'] = ['home-assistant']
        self.images()
        self.archive()
        (self.root / 'home-assistant-config.tar.gz').write_bytes(b'')
        self.manifest()
        with self.assertRaisesRegex(ValueError, 'byte count'):
            verify.verify(self.root)

    def test_empty_or_invalid_image_inventory_rejected_with_valid_hashes(self):
        for images in ({}, [], {'www-tunnel-cloudflared-1': {}},
                       {'www-tunnel-cloudflared-1': {'id': 'not-an-image', 'repo_digests': []}},
                       {'www-tunnel-cloudflared-1': {'id': 'sha256:' + 'a' * 64,
                                                   'repo_digests': ['unreviewed:latest']}}):
            with self.subTest(images=images):
                (self.root / 'images.json').write_text(json.dumps(images))
                self.manifest()
                with self.assertRaises(ValueError):
                    verify.verify(self.root)

    def test_required_recovery_files_cannot_be_omitted(self):
        for member in ('compose/cloudflared/compose.yaml',
                       'credentials/cloudflared/TUNNEL_TOKEN', 'containers.env'):
            with self.subTest(member=member):
                self.archive(omit=member)
                self.manifest()
                with self.assertRaisesRegex(ValueError, 'required service files'):
                    verify.verify(self.root)

    def test_duplicate_normalized_recovery_path_rejected(self):
        duplicate = tarfile.TarInfo('compose//cloudflared/./compose.yaml')
        self.archive(duplicate)
        self.manifest()
        with self.assertRaisesRegex(ValueError, 'Duplicate recovery'):
            verify.verify(self.root)

    def test_enrolled_bambuddy_can_have_an_empty_auth_environment(self):
        self.host['services'] = ['bambuddy']
        self.images()
        self.archive(empty='credentials/bambuddy/environment')
        for name in ('bambuddy-data.tar.gz', 'bambuddy-studio.tar.gz',
                     'bambuddy-tailscale.tar.gz'):
            (self.root / name).write_bytes(b'fixture payload')
        self.manifest()
        self.assertEqual(verify.verify(self.root), self.host)

    def test_all_service_recovery_files_and_image_identities_are_supported(self):
        self.host['services'] = ['cloudflared', 'control-center', 'bambuddy',
                                 'hindsight', 'home-assistant']
        self.images()
        self.archive()
        for name in ('control-center.dump', 'control-center-media.tar.gz',
                     'home-assistant-config.tar.gz', 'bambuddy-data.tar.gz',
                     'bambuddy-studio.tar.gz', 'bambuddy-tailscale.tar.gz',
                     'hindsight.dump', 'hindsight-codex-home.tar.gz'):
            (self.root / name).write_bytes(b'fixture payload')
        self.manifest()
        self.assertEqual(verify.verify(self.root), self.host)
        for member in ('compose/control-center/release.json',
                       'compose/bambuddy/tailscale/serve.json',
                       'credentials/bambuddy/serve.json',
                       'credentials/hindsight/environment',
                       'credentials/control-center/POSTGRES_PASSWORD'):
            with self.subTest(member=member):
                self.archive(omit=member)
                self.manifest()
                with self.assertRaisesRegex(ValueError, 'required service files'):
                    verify.verify(self.root)


if __name__ == '__main__':
    unittest.main()
