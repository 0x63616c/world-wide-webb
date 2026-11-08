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
            'WWW_IMAGE': 'ghcr.io/example/control-center@sha256:' + 'b' * 64,
            'WWW_DATA_DIR': directory + '/www-data',
            'WWW_SECRETS_DIR': directory + '/www-secrets',
            'HA_URL': 'http://192.0.2.130:8123',
            'WORKER_CYCLES': 'off',
            'TUNNEL_TOKEN_FILE': directory + '/tunnel-token',
            'HINDSIGHT_ENV_FILE': str(env_file),
            'BESZEL_ENV_FILE': str(env_file),
            'BESZEL_CONFIG_FILE': directory + '/beszel-config.yml',
            'PENPOT_ENV_FILE': str(env_file),
            'PENPOT_MCP_TEMPLATE': directory + '/mcp.conf',
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
        assert set(models) == {'beszel', 'bambuddy', 'control-center', 'cloudflared', 'hindsight', 'home-assistant', 'penpot'}
        bambuddy = models['bambuddy']
        assert bambuddy['services']['bambu-studio-api']['platform'] == 'linux/amd64'
        for volume in ('bambuddy_data', 'tailscale_state', 'bambu_studio_api_data'):
            assert bambuddy['volumes'][volume]['external'] is True
        beszel = models['beszel']
        assert beszel['name'] == 'beszel'
        hub = beszel['services']['beszel']
        owner = beszel['services']['data-owner']
        assert set(beszel['services']) == {'beszel', 'data-owner'}
        assert hub['user'] == '450:450'
        assert int(hub['mem_limit']) == 128 * 1024 ** 2 and hub['cpus'] == 0.5
        assert hub['read_only'] is True and hub['cap_drop'] == ['ALL']
        assert hub['security_opt'] == ['no-new-privileges:true']
        assert hub['ports'] == [{'mode': 'ingress', 'host_ip': '127.0.0.1',
                                 'target': 8090, 'published': '8090', 'protocol': 'tcp'}]
        assert hub['environment']['APP_URL'] == 'https://beszel.worldwidewebb.co'
        assert hub['environment']['CHECK_UPDATES'] == 'false'
        assert hub['healthcheck']['test'] == ['CMD', '/beszel', 'health', '--url',
                                             'http://127.0.0.1:8090']
        assert hub['depends_on']['data-owner']['condition'] == 'service_completed_successfully'
        assert owner['user'] == '0:0' and owner['network_mode'] == 'none'
        assert owner['read_only'] is True and owner['cap_drop'] == ['ALL']
        assert owner['cap_add'] == ['CHOWN']
        assert owner['security_opt'] == ['no-new-privileges:true']
        assert owner['command'] == ['chown', '450:450', '/beszel_data']
        assert int(owner['mem_limit']) == 16 * 1024 ** 2 and owner['pids_limit'] == 16
        assert owner.get('restart', 'no') == 'no'
        assert beszel['volumes']['beszel_data']['name'] == 'beszel_beszel_data'
        assert beszel['volumes']['beszel_data'].get('external', False) is False
        assert owner['volumes'][0]['type'] == 'volume'
        assert owner['volumes'][0]['source'] == 'beszel_data'
        assert owner['volumes'][0]['target'] == '/beszel_data'
        data = next(v for v in hub['volumes'] if v['target'] == '/beszel_data')
        assert data['type'] == 'volume' and data['source'] == 'beszel_data'
        config = next(v for v in hub['volumes'] if v['target'] == '/beszel_data/config.yml')
        assert config['type'] == 'bind' and config['read_only'] is True
        assert config['source'] == fixtures['BESZEL_CONFIG_FILE']
        for service in (hub, owner):
            assert service['logging']['driver'] == 'json-file'
            assert 'max-size' in service['logging']['options']
            assert 'max-file' in service['logging']['options']
        # Avoid resolving env files here: assert raw delivery at the model boundary.
        path = root / 'beszel/compose.yaml'
        raw = subprocess.run(['docker-compose', '-f', str(path), 'config', '--format',
                              'json', '--no-env-resolution'], env={**env, **fixtures},
                             check=True, capture_output=True, text=True, timeout=30)
        raw_files = json.loads(raw.stdout)['services']['beszel']['env_file']
        assert len(raw_files) == 1
        assert raw_files[0]['path'] == str(env_file) and raw_files[0]['format'] == 'raw'
        assert raw_files[0].get('required', True) is True
        ha = models['home-assistant']
        assert ha['volumes']['ha_config']['external'] is True
        assert ha['services']['home-assistant']['network_mode'] == 'host'
        assert 'ha0' in '\n'.join(ha['services']['home-assistant']['entrypoint'])
        assert models['control-center']['services']['www']['environment']['WORKER_CYCLES'] == 'off'
        assert models['control-center']['volumes']['www_sqlite']['external'] is True
        assert 'postgres' not in models['control-center']['services']
        assert models['penpot']['volumes']['assets']['external'] is True
        assert models['penpot']['volumes']['postgres']['external'] is True
        for project in ('beszel', 'control-center', 'cloudflared', 'hindsight', 'penpot'):
            path = root / project / 'compose.yaml'
            result = subprocess.run(['docker-compose', '--project-directory', str(path.parent),
                                     '-f', str(path), 'config', '--quiet'], env=env,
                                    capture_output=True, text=True, timeout=30)
            assert result.returncode != 0, f'{project} accepted missing required configuration'
        for missing in ('BESZEL_ENV_FILE', 'BESZEL_CONFIG_FILE'):
            partial = {key: value for key, value in fixtures.items() if key != missing}
            path = root / 'beszel/compose.yaml'
            result = subprocess.run(['docker-compose', '-f', str(path), 'config', '--quiet'],
                                    env={**env, **partial}, capture_output=True, text=True,
                                    timeout=30)
            assert result.returncode != 0, f'beszel accepted missing {missing}'


if __name__ == '__main__':
    check(Path(sys.argv[1]).resolve())
