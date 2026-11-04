#!/usr/bin/env python3
"""Project selected SOPS files and recreate containers after secret rotation."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile

WWW_KEYS = ('POSTGRES_PASSWORD', 'HA_TOKEN', 'ALARM_API_TOKEN', 'HOME_LAT',
            'HOME_LON', 'WIFI_GUEST_SSID', 'WIFI_GUEST_PASSWORD')
FILES = {
    'control-center': {name: 'www-' + name for name in WWW_KEYS},
    'hindsight': {'environment': 'hindsight-env'},
    'cloudflared': {'TUNNEL_TOKEN': 'tunnel-token'},
    'bambuddy': {'environment': 'bambuddy-environment'},
}


def private_directory(path):
    path.mkdir(mode=0o700, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise RuntimeError('Runtime directory must be owned by the service user with mode 0700')


def atomic_file(path, content):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as output:
        temporary = Path(output.name)
        try:
            os.fchmod(output.fileno(), 0o600)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def read_private_file(path):
    # SOPS source symlinks are intentional; inspect the opened target.
    with path.open('rb') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise RuntimeError('Secret must be a service-owned, owner-only regular file')
        return source.read()


def reconcile(service, source, runtime, compose_root, compose_env):
    private_directory(runtime)
    destination = runtime / service
    private_directory(destination)
    # Hold across projection AND Compose; an interrupted rotation stays dirty.
    lock_path = runtime / (service + '.lock')
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        material = {name: read_private_file(source / key) for name, key in FILES[service].items()}
        if service == 'bambuddy':
            material['serve.json'] = (compose_root / service / 'tailscale/serve.json').read_bytes()
        dirty = runtime / (service + '.dirty')
        for name, content in material.items():
            target = destination / name
            if target.is_symlink():
                raise RuntimeError('Runtime secret destination must not be a symlink')
            changed = not target.exists() or read_private_file(target) != content
            if changed:
                # Persist retry requirement before replacing the inode.
                atomic_file(dirty, b'')
                atomic_file(target, content)
        env = os.environ.copy()
        if service == 'control-center':
            # Release versions are reviewed Git configuration, never secret-file
            # overrides. The independent promotion validator also checks CI input.
            release = json.loads((compose_root / service / 'release.json').read_text())
            import importlib.util
            spec = importlib.util.spec_from_file_location('promotion', Path(__file__).with_name('promote-control-center.py'))
            promotion = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(promotion)
            promotion.validate(release)
            env.update(WWW_IMAGE=release['image'], POSTGRES_IMAGE=release['postgresImage'])
        # These paths contain only the selected service's files and are inside
        # Colima's service-user home mount; never expose the SOPS backing store.
        env.update({
            'control-center': {'WWW_SECRETS_DIR': str(destination)},
            'hindsight': {'HINDSIGHT_ENV_FILE': str(destination / 'environment')},
            'cloudflared': {'TUNNEL_TOKEN_FILE': str(destination / 'TUNNEL_TOKEN')},
            'bambuddy': {'BAMBUDDY_ENV_FILE': str(destination / 'environment'),
                         'BAMBUDDY_SERVE_CONFIG': str(destination / 'serve.json')},
        }[service])
        command = ['docker-compose', '--env-file', str(compose_env),
                   '--project-directory', str(compose_root / service),
                   '-f', str(compose_root / service / 'compose.yaml'),
                   'up', '-d', '--wait', '--wait-timeout', '180']
        if dirty.exists():
            command.append('--force-recreate')
        subprocess.run(command, env=env, check=True, timeout=300)
        dirty.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('service', choices=FILES)
    args = parser.parse_args()
    if os.geteuid() == 0:
        raise SystemExit('Run as _containers, never root')
    reconcile(args.service, Path('/run/secrets'), Path('/var/lib/_containers/runtime-secrets'),
              Path('/etc/homelab/services'), Path('/run/secrets/containers-env'))


if __name__ == '__main__':
    main()
