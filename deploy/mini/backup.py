#!/usr/bin/env python3
"""Nightly homelab snapshots, followed by verified append-only NAS copies.

Briefly stops Control Center, HA and Bambuddy individually for consistent file
and database snapshots. Hindsight uses its existing online PostgreSQL backup.
Failed snapshots remain local. Seven completed local sets are retained; NAS
copies are never purged. No alerts are sent.
"""
import argparse
import contextlib
import datetime
import gzip
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import time

from sqlite_snapshot import sqlite_snapshot

HOME = Path('/Users/calum')
ROOT = HOME / 'homelab-backups'
DOCKER = '/opt/homebrew/bin/docker'
os.environ['PATH'] = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'


def run(args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, **kwargs)


def docker(context, *args):
    return [DOCKER, '--context', context, *args]


@contextlib.contextmanager
def stopped(context, name):
    state = subprocess.check_output(docker(context, 'inspect', '--format', '{{.State.Running}}', name), text=True).strip()
    if state != 'true':
        raise RuntimeError(f'{name} was already stopped; refusing to change its intended state')
    run(docker(context, 'stop', '--time', '60', name), stdout=subprocess.DEVNULL)
    try:
        yield
    finally:
        run(docker(context, 'start', name), stdout=subprocess.DEVNULL)


def archive(output, parent, *names):
    run(['tar', '-czf', output, '-C', parent, *names])


def container_files(output, context, name, path):
    # docker cp works on stopped containers and includes hidden config files.
    with gzip.open(output, 'wb') as target:
        process = subprocess.Popen(docker(context, 'cp', f'{name}:{path}/.', '-'), stdout=subprocess.PIPE)
        try:
            shutil.copyfileobj(process.stdout, target, 1024 * 1024)
        finally:
            process.stdout.close()
        if process.wait() != 0:
            raise RuntimeError(f'Failed copying {name} configuration')


def snapshot(destination, database_engine="sqlite"):
    app = HOME / 'www-control-center'
    # Serialize against release.sh/recover.sh; never remove someone else's lock.
    lock = app / 'deploy.lock'
    lock.mkdir()
    try:
        images = {}
        for context, name in [('orbstack', n) for n in
                              (['www-control-center-postgres-1'] if database_engine == 'postgres' else []) +
                              ['www-control-center-www-1', 'hindsight', 'bambuddy', 'bambu-studio-api',
                               'bambuddy-tailscale', 'www-tunnel-cloudflared-1']] + [('colima-ha', 'www-home-assistant-home-assistant-1')]:
            image_id = subprocess.check_output(docker(context, 'inspect', '--format', '{{.Image}}', name), text=True).strip()
            digests = json.loads(subprocess.check_output(
                docker(context, 'image', 'inspect', '--format', '{{json .RepoDigests}}', image_id), text=True))
            images[name] = {'id': image_id, 'repo_digests': digests}
        (destination / 'images.json').write_text(json.dumps(images, indent=2))
        infra = HOME / 'homelab-infra/cloudflare'
        if (infra / 'cloudflare.tfstate').is_file():
            archive(destination / 'cloudflare-infra.tar.gz', infra,
                    'cloudflare.tfstate', 'production.tfvars.json')
        with stopped('orbstack', 'www-control-center-www-1'):
            if database_engine == 'postgres':
                with (destination / 'control-center.dump').open('xb') as output:
                    run(docker('orbstack', 'exec', 'www-control-center-postgres-1',
                               'pg_dump', '-U', 'postgres', '-d', 'control_center', '-Fc'), stdout=output)
            elif database_engine == 'sqlite':
                sqlite_snapshot(app / 'data/sqlite/control-center.sqlite', destination / 'control-center.sqlite')
            else:
                raise ValueError('Unsupported database engine')
            archive(destination / 'control-center-files.tar.gz', app,
                    'data/media', 'secrets', 'runtime.env', 'current.env', 'compose.yaml', 'release.sh', 'recover.sh')
    finally:
        lock.rmdir()
    print('Control Center snapshot complete; service restarted', flush=True)

    with stopped('colima-ha', 'www-home-assistant-home-assistant-1'):
        container_files(destination / 'home-assistant-config.tar.gz', 'colima-ha',
                        'www-home-assistant-home-assistant-1', '/config')
    archive(destination / 'home-assistant-host.tar.gz', HOME / 'home-assistant',
            'compose.yaml', 'start-ha.sh', 'install-network-startup.sh', 'socket_vmnet-startup.plist')
    print('Home Assistant snapshot complete; service restarted', flush=True)

    with stopped('orbstack', 'bambuddy'):
        container_files(destination / 'bambuddy-data.tar.gz', 'orbstack', 'bambuddy', '/app/data')
        with stopped('orbstack', 'bambu-studio-api'):
            container_files(destination / 'bambuddy-studio.tar.gz', 'orbstack', 'bambu-studio-api', '/app/data')
        with stopped('orbstack', 'bambuddy-tailscale'):
            container_files(destination / 'bambuddy-tailscale.tar.gz', 'orbstack', 'bambuddy-tailscale', '/var/lib/tailscale')
    archive(destination / 'bambuddy-host.tar.gz', HOME / 'bambuddy', 'docker-compose.yml', 'tailscale', 'scripts')
    print('Bambuddy snapshot complete; service restarted', flush=True)

    run(['bash', HOME / 'hindsight/backup.sh'], stdout=subprocess.DEVNULL)
    latest = max((HOME / 'hindsight/backups').glob('hindsight-*.dump'), key=lambda p: p.stat().st_mtime_ns)
    shutil.copyfile(latest, destination / 'hindsight.dump')
    archive(destination / 'hindsight-codex-home.tar.gz', HOME / 'hindsight', 'codex-home')
    archive(destination / 'hindsight-host.tar.gz', HOME / 'hindsight',
            'run.sh', 'backup.sh', 'healthcheck.sh', 'hindsight.env', 'api-key',
            'cp-access-key', 'ha-token', 'alert-webhook.env')
    archive(destination / 'tunnel-host.tar.gz', HOME / 'www-tunnel', 'compose.yaml', 'runtime.env', 'secrets')
    archive(destination / 'startup.tar.gz', '/',
            'Library/LaunchDaemons/homebrew.mxcl.socket_vmnet.plist',
            'Users/calum/.colima/ha/colima.yaml',
            'Users/calum/.colima/_lima/_config/override.yaml',
            'Users/calum/Library/LaunchAgents/com.calum.home-assistant-start.plist',
            'Users/calum/Library/LaunchAgents/com.calum.hindsight-backup.plist',
            'Users/calum/Library/LaunchAgents/com.calum.hindsight-healthcheck.plist')
    print('Hindsight and tunnel snapshots complete', flush=True)


def verify_restarted_services():
    services = [('orbstack', name) for name in
                ['www-control-center-www-1', 'bambuddy', 'bambu-studio-api', 'bambuddy-tailscale', 'hindsight']]
    services.append(('colima-ha', 'www-home-assistant-home-assistant-1'))
    deadline = time.monotonic() + 180
    for context, name in services:
        while True:
            state = json.loads(subprocess.check_output(
                docker(context, 'inspect', '--format', '{{json .State}}', name), text=True))
            if state.get('Running') and state.get('Health', {}).get('Status', 'healthy') == 'healthy':
                break
            if time.monotonic() >= deadline:
                raise RuntimeError(f'{name} did not recover after snapshot')
            time.sleep(2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database-engine', choices=['postgres', 'sqlite'], default='sqlite')
    args = parser.parse_args()
    os.umask(0o077)
    ROOT.mkdir(mode=0o700, exist_ok=True)
    if shutil.disk_usage(ROOT).free < 5 * 1024 ** 3:
        raise RuntimeError('Less than 5 GiB free; refusing to fill the production disk')
    lock = ROOT / 'backup.lock'
    lock.mkdir()
    try:
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        destination = ROOT / stamp
        destination.mkdir()
        snapshot(destination, args.database_engine)
        verify_restarted_services()
        uploader = Path(__file__).with_name('nas-upload.py')
        payloads = sorted(destination.iterdir())
        manifest = destination / 'verified-files.jsonl'
        with manifest.open('w') as result:
            run([sys.executable, uploader, '--config', ROOT / 'nas-credentials.json',
                 '--destination', f'/Homelab/backups/mac-mini/{stamp}',
                 *payloads], stdout=result)
        # A completion marker is uploaded only after every payload has passed
        # read-back verification. Incomplete NAS directories are never complete sets.
        complete = destination / 'COMPLETE.json'
        complete.write_text(json.dumps({'created_at': stamp,
                                       'files': [json.loads(line) for line in manifest.read_text().splitlines()]}, indent=2))
        run([sys.executable, uploader, '--config', ROOT / 'nas-credentials.json',
             '--destination', f'/Homelab/backups/mac-mini/{stamp}', complete])
        (destination / 'NAS_VERIFIED').touch()
        print(f'Backup complete and verified: {stamp}', flush=True)
        completed = sorted(p for p in ROOT.iterdir()
                           if re.fullmatch(r'\d{8}T\d{6}Z', p.name)
                           and not p.is_symlink() and (p / 'NAS_VERIFIED').is_file())
        for old in completed[:-7]:
            shutil.rmtree(old)
    finally:
        lock.rmdir()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Backup failed: {type(error).__name__}; local snapshots retained', file=sys.stderr)
        sys.exit(1)
