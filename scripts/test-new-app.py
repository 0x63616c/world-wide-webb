#!/usr/bin/env python3
"""Scaffold in isolation; optionally prove the generated Cloudflare bundle."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend-check', action='store_true')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='new-app-check-') as temporary:
        root = Path(temporary)
        (root / 'scripts').mkdir()
        shutil.copy2(ROOT / 'scripts/new-app.sh', root / 'scripts/new-app.sh')
        shutil.copytree(ROOT / 'templates', root / 'templates',
                        ignore=shutil.ignore_patterns('node_modules', '.wrangler', '*.xcodeproj'))
        (root / 'apps').mkdir()
        (root / 'sites').mkdir()
        (root / 'sites/.pages').write_text('')
        (root / 'sites/index.html').write_text('<!-- apps: scripts/new-app.sh adds a card per app above this line -->\n')
        # Project compilation is covered by the real Mac template job.
        (root / 'bin').mkdir()
        generator = root / 'bin/xcodegen'
        generator.write_text('#!/bin/sh\nexit 0\n')
        generator.chmod(0o755)
        env = dict(os.environ, PATH=str(root / 'bin') + os.pathsep + os.environ['PATH'])

        def scaffold(*arguments, success=True):
            result = subprocess.run(['bash', str(root / 'scripts/new-app.sh'), *arguments],
                                    env=env, text=True, capture_output=True, timeout=30)
            assert (result.returncode == 0) == success, result.stdout + result.stderr

        scaffold('Plainr', 'plainr')
        assert not (root / 'apps/plainr/backend').exists()
        scaffold('Samplr', 'samplr', '--backend', 'cloudflare')
        backend = root / 'apps/samplr/backend'
        config = json.loads((backend / 'wrangler.jsonc').read_text())
        assert config['env']['staging']['name'] == 'samplr-api-staging'
        assert config['env']['production']['name'] == 'samplr-api-production'
        assert config['workers_dev'] is False and config['preview_urls'] is False
        assert not (backend / 'node_modules').exists()
        assert not (backend / '.wrangler').exists()
        assert (backend / 'bun.lock').read_bytes() == (ROOT / 'templates/cloudflare-backend/bun.lock').read_bytes()
        assert 'testflight: false' in (root / 'apps/samplr/app.yml').read_text()
        for path in (root / 'apps/samplr').rglob('*'):
            if path.is_file():
                assert b'__SLUG__' not in path.read_bytes(), path
        scaffold('Samplr', 'samplr', '--backend', 'cloudflare', success=False)
        scaffold('Invalidr', 'invalidr', '--backend', 'unknown', success=False)
        assert not (root / 'apps/invalidr').exists()
        assert (root / 'sites/.pages').read_text().splitlines() == ['plainr', 'samplr']
        if args.backend_check:
            spec = importlib.util.spec_from_file_location('backends', ROOT / 'scripts/check-app-backends.py')
            backends = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(backends)
            backends.check(backend)
        print('PASS: isolated default/Cloudflare scaffold, substitutions, lockfile and refusal boundaries')


if __name__ == '__main__':
    main()
