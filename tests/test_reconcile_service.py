import importlib.util
import os
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('reconcile', Path(__file__).parents[1] / 'scripts/reconcile-service.py')
reconcile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reconcile)


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        self.runtime = self.root / 'runtime'
        self.token = self.source / 'tunnel-token'
        self.token.write_bytes(b'synthetic-token')
        self.token.chmod(0o400)

    def run_reconcile(self):
        reconcile.reconcile('cloudflared', self.source, self.runtime,
                            self.root / 'compose', self.root / 'compose.env')

    @patch.object(reconcile.subprocess, 'run')
    def test_projection_is_private_and_rotation_recreates_once(self, run):
        self.run_reconcile()
        target = self.runtime / 'cloudflared/TUNNEL_TOKEN'
        self.assertEqual(target.read_bytes(), b'synthetic-token')
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        self.assertIn('--force-recreate', run.call_args.args[0])
        self.assertNotIn('synthetic-token', str(run.call_args))
        self.assertEqual(run.call_args.kwargs['env']['TUNNEL_TOKEN_FILE'], str(target))
        inode = target.stat().st_ino
        self.run_reconcile()
        self.assertNotIn('--force-recreate', run.call_args.args[0])
        self.assertEqual(target.stat().st_ino, inode)
        self.token.chmod(0o600)
        self.token.write_bytes(b'rotated-fixture')
        self.run_reconcile()
        self.assertIn('--force-recreate', run.call_args.args[0])
        self.assertEqual(target.read_bytes(), b'rotated-fixture')

    @patch.object(reconcile.subprocess, 'run')
    def test_failed_compose_leaves_retry_marker(self, run):
        run.side_effect = subprocess.CalledProcessError(1, 'compose')
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_reconcile()
        self.assertTrue((self.runtime / 'cloudflared.dirty').exists())
        run.side_effect = None
        self.run_reconcile()
        self.assertIn('--force-recreate', run.call_args.args[0])
        self.assertFalse((self.runtime / 'cloudflared.dirty').exists())

    @patch.object(reconcile.subprocess, 'run')
    def test_world_readable_source_is_rejected_before_compose(self, run):
        self.token.chmod(0o644)
        with self.assertRaises(RuntimeError):
            self.run_reconcile()
        run.assert_not_called()

    @patch.object(reconcile.subprocess, 'run')
    def test_sops_source_symlink_is_supported(self, run):
        actual = self.source / 'generation-token'
        self.token.rename(actual)
        self.token.symlink_to(actual)
        self.run_reconcile()
        self.assertEqual((self.runtime / 'cloudflared/TUNNEL_TOKEN').read_bytes(), b'synthetic-token')

    @patch.object(reconcile.subprocess, 'run')
    def test_runtime_symlink_is_rejected(self, run):
        other = self.root / 'other'
        other.mkdir(mode=0o700)
        self.runtime.symlink_to(other)
        with self.assertRaises(RuntimeError):
            self.run_reconcile()
        run.assert_not_called()

    @patch.object(reconcile.subprocess, 'run')
    def test_only_requested_service_files_are_projected(self, run):
        (self.source / 'github-read-token').write_text('root-token-fixture')
        self.run_reconcile()
        self.assertEqual({p.name for p in (self.runtime / 'cloudflared').iterdir()}, {'TUNNEL_TOKEN'})

    @patch.object(reconcile.subprocess, 'run')
    def test_control_center_uses_git_release_images(self, run):
        compose = self.root / 'compose'
        (compose / 'control-center').mkdir(parents=True)
        committed = Path(__file__).parents[1] / 'services/control-center/release.json'
        (compose / 'control-center/release.json').write_bytes(committed.read_bytes())
        for name in reconcile.WWW_KEYS:
            source = self.source / ('www-' + name)
            source.write_bytes(b'fixture')
            source.chmod(0o400)
        with patch.dict(os.environ, {'WWW_IMAGE': 'unreviewed:latest', 'POSTGRES_IMAGE': 'postgres:latest'}):
            reconcile.reconcile('control-center', self.source, self.runtime, compose, self.root / 'compose.env')
        release = json.loads(committed.read_text())
        env = run.call_args.kwargs['env']
        self.assertEqual(env['WWW_IMAGE'], release['image'])
        self.assertNotIn('POSTGRES_IMAGE', env)


if __name__ == '__main__':
    unittest.main()


class ComposeSecretTests(unittest.TestCase):
    def test_penpot_model_never_retains_exported_secret_extensions(self):
        path = Path(__file__).parents[1] / 'services/penpot/compose.yaml'
        model = json.loads(path.read_text())
        self.assertFalse(any(k.startswith('x-') for k in model))
        for service in model['services'].values():
            for name,value in service.get('environment',{}).items():
                if any(key in name.upper() for key in ('SECRET','PASSWORD','TOKEN','KEY')):
                    self.assertTrue(value.startswith('${'), 'Credential must be a private-file reference')
