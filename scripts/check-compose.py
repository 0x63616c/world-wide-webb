#!/usr/bin/env python3
"""Validate Compose models without a daemon, credentials, or container startup."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


def check(root):
    with tempfile.TemporaryDirectory() as directory:
        temporary = Path(directory)
        env_file = temporary / 'hindsight.env'
        env_file.write_text('HINDSIGHT_TEST_FIXTURE=1\n')
        env = {key: os.environ[key] for key in ('PATH', 'TMPDIR') if key in os.environ}
        env.update(HOME=directory, COMPOSE_DISABLE_ENV_FILE='true')
        fixtures = {
            'POSTGRES_IMAGE': 'postgres@sha256:' + 'a' * 64,
            'WWW_IMAGE': 'ghcr.io/example/control-center@sha256:' + 'b' * 64,
            'WWW_DATA_DIR': directory + '/www-data',
            'WWW_SECRETS_DIR': directory + '/www-secrets',
            'HA_URL': 'http://192.0.2.130:8123',
            'WORKER_CYCLES': 'off',
            'TUNNEL_TOKEN_FILE': directory + '/tunnel-token',
            'HINDSIGHT_ENV_FILE': str(env_file),
            'HINDSIGHT_DATA_DIR': directory + '/hindsight-data',
            'HINDSIGHT_CODEX_HOME': directory + '/codex-home',
            'BAMBUDDY_ENV_FILE': str(env_file),
            'BAMBUDDY_SERVE_CONFIG': directory + '/serve.json',
        }
        models = {}
        for path in sorted(root.glob('*/compose.yaml')):
            command = ['docker-compose', '--project-directory', str(path.parent),
                       '-f', str(path), 'config', '--format', 'json']
            result = subprocess.run(command, env={**env, **fixtures}, check=True,
                                    capture_output=True, text=True, timeout=30)
            model = models[path.parent.name] = json.loads(result.stdout)
            for name, service in model['services'].items():
                image = service['image']
                assert re.fullmatch(r'.+@sha256:[0-9a-f]{64}', image), (name, image)
                for volume in service.get('volumes', []):
                    if volume['type'] == 'bind':
                        assert volume.get('bind', {}).get('create_host_path') is False, (name, volume)
            print('Validated', path.parent.name)
        assert set(models) == {'bambuddy', 'control-center', 'cloudflared', 'hindsight', 'home-assistant'}
        bambuddy = models['bambuddy']
        assert bambuddy['services']['bambu-studio-api']['platform'] == 'linux/amd64'
        for volume in ('bambuddy_data', 'tailscale_state', 'bambu_studio_api_data'):
            assert bambuddy['volumes'][volume]['external'] is True
        ha = models['home-assistant']
        assert ha['volumes']['ha_config']['external'] is True
        assert ha['services']['home-assistant']['network_mode'] == 'host'
        assert 'ha0' in '\n'.join(ha['services']['home-assistant']['entrypoint'])
        assert models['control-center']['services']['www']['environment']['WORKER_CYCLES'] == 'off'
        for project in ('control-center', 'cloudflared', 'hindsight'):
            path = root / project / 'compose.yaml'
            result = subprocess.run(['docker-compose', '--project-directory', str(path.parent),
                                     '-f', str(path), 'config', '--quiet'], env=env,
                                    capture_output=True, text=True, timeout=30)
            assert result.returncode != 0, f'{project} accepted missing required configuration'


if __name__ == '__main__':
    check(Path(sys.argv[1]).resolve())
