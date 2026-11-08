#!/usr/bin/env python3
"""Consistent service snapshots. Must execute beneath homelab-operation."""
from contextlib import contextmanager, ExitStack
import json
import datetime
import hashlib
import os
from pathlib import Path
import subprocess
import shutil
import time
import uuid
import importlib.util

spec = importlib.util.spec_from_file_location('durable', Path(__file__).with_name('durable.py'))
durable = importlib.util.module_from_spec(spec)
spec.loader.exec_module(durable)

SOCKETS = {
    'services': 'unix:///var/lib/_containers/.colima/services/docker.sock',
    'ha': 'unix:///var/lib/_containers/.colima-ha/ha/docker.sock',
}
NAMES = {
    'control-center': ('services', ['www-control-center-www-1']),
    'bambuddy': ('services', ['bambuddy', 'bambu-studio-api', 'bambuddy-tailscale']),
    'hindsight': ('services', ['hindsight']),
    'cloudflared': ('services', ['www-tunnel-cloudflared-1']),
    'penpot': ('services', ['penpot-penpot-frontend-1', 'penpot-penpot-mcp-1',
                          'penpot-penpot-exporter-1', 'penpot-penpot-admin-console-1',
                          'penpot-penpot-backend-1', 'penpot-penpot-postgres-1',
                          'penpot-penpot-valkey-1']),
    'home-assistant': ('ha', ['www-home-assistant-home-assistant-1']),
}


def docker(runtime, *args):
    return ['docker', '--host', SOCKETS[runtime], *args]


def run(args, **kwargs):
    kwargs.setdefault('timeout', 900)
    kwargs.setdefault('stderr', subprocess.DEVNULL)
    return subprocess.run(args, check=True, **kwargs)


def running_state(runtime, name):
    projection = ('{"Running":{{json .State.Running}},'
                  '"Health":{{if .State.Health}}'
                  '{"Status":{{json .State.Health.Status}}}{{else}}null{{end}}}')
    result = run(docker(runtime, 'inspect', '--format', projection, name),
                 capture_output=True, text=True, timeout=30)
    return json.loads(result.stdout)


def healthy(runtime, name):
    deadline = time.monotonic() + 240
    while True:
        state = running_state(runtime, name)
        health = state.get('Health') or {}
        has_no_healthcheck = name in ('bambuddy-tailscale', 'www-tunnel-cloudflared-1',
                                     'penpot-penpot-frontend-1', 'penpot-penpot-mcp-1',
                                     'penpot-penpot-exporter-1', 'penpot-penpot-admin-console-1',
                                     'penpot-penpot-backend-1')
        if state.get('Running') and (
                health.get('Status') == 'healthy' or (has_no_healthcheck and not health)):
            return
        if time.monotonic() >= deadline:
            raise RuntimeError('Service did not recover after snapshot: ' + name)
        time.sleep(2)


@contextmanager
def stopped(runtime, name, destination):
    if not running_state(runtime, name).get('Running'):
        raise RuntimeError('Service already stopped; refusing to change intended state: ' + name)
    marker = destination / (name + '.restart-required')
    durable.write_json(marker, {'runtime': runtime, 'container': name})
    stop_completed = False
    try:
        run(docker(runtime, 'stop', '--time', '120', name), stdout=subprocess.DEVNULL, timeout=150)
        stop_completed = True
        yield
    finally:
        run(docker(runtime, 'start', name), stdout=subprocess.DEVNULL, timeout=150)
        healthy(runtime, name)
        # A timed-out client does not cancel the daemon's stop request. Even
        # temporary health after start cannot prove that delayed stop is over.
        if stop_completed:
            durable.remove(marker)


def container_files(destination, runtime, name, path):
    # Stream Docker's tar archive through gzip with bounded process waits.
    with destination.open('wb') as target:
        process = subprocess.Popen(docker(runtime, 'cp', name + ':' + path + '/.', '-'),
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            run(['gzip', '-c'], stdin=process.stdout, stdout=target)
            process.stdout.close()
            if process.wait(timeout=30) != 0:
                raise RuntimeError('Container file snapshot failed: ' + name)
        finally:
            process.stdout.close()
            if process.poll() is None:
                process.kill()
                process.wait()


def export_banks(destination):
    helper = Path(__file__).with_name('hindsight-pg.py').read_text()
    result = run(docker('services', 'exec', 'hindsight', 'python3', '-c', helper, 'banks'),
                 capture_output=True, text=True)
    banks = json.loads(result.stdout)
    if not isinstance(banks, list) or any(not isinstance(bank, str) or not bank for bank in banks):
        raise ValueError('Invalid Hindsight bank inventory')
    if len(banks) != len(set(banks)):
        raise ValueError('Duplicate Hindsight bank identity')
    staging = destination / 'bank-exports'
    staging.mkdir(mode=0o700)
    index = {}
    try:
        for bank in banks:
            name = hashlib.sha256(bank.encode()).hexdigest() + '.zip'
            remote = '/tmp/homelab-export-' + uuid.uuid4().hex + '-' + name
            try:
                run(docker('services', 'exec', 'hindsight', 'hindsight-admin', 'export-bank',
                           '--bank=' + bank, '--output=' + remote), stdout=subprocess.DEVNULL)
                target = staging / name
                run(docker('services', 'cp', 'hindsight:' + remote, str(target)), stdout=subprocess.DEVNULL)
                if target.is_symlink() or not target.is_file() or not target.stat().st_size:
                    raise ValueError('Missing or unsafe Hindsight export')
                target.chmod(0o600)
                index[name] = bank
            finally:
                run(docker('services', 'exec', 'hindsight', 'rm', '-f', remote), stdout=subprocess.DEVNULL)
        (staging / 'index.json').write_text(json.dumps(index, indent=2))
        run(['tar', '-czf', str(destination / 'hindsight-bank-exports.tar.gz'), '-C', str(staging), '.'])
    finally:
        shutil.rmtree(staging)


def online_control_center(destination):
    name = 'www-control-center-www-1'
    if not running_state('services', name).get('Running'):
        raise RuntimeError('Hourly snapshots require a running writer')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    remote = '/app/data/.hourly-' + stamp + '.sqlite'
    mounts = json.loads(run(docker('services', 'inspect', '--format', '{{json .Mounts}}', name),
                            capture_output=True, text=True, timeout=30).stdout)
    data = [mount for mount in mounts if mount.get('Destination') == '/app/data']
    if len(data) != 1 or data[0].get('Type') != 'volume':
        raise RuntimeError('Hourly SQLite requires a local Linux volume')
    volume = json.loads(run(docker('services', 'volume', 'inspect', data[0]['Name']),
                            capture_output=True, text=True, timeout=30).stdout)[0]
    if volume.get('Driver') != 'local' or volume.get('Options'):
        raise RuntimeError('Network-backed SQLite storage is forbidden')
    # Do not remove an earlier attempt if its timestamp output already exists.
    run(docker('services', 'exec', name, 'test', '!', '-e', remote),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    pending = destination / (name + '.online-snapshot-pending')
    durable.write_json(pending, {'runtime': 'services', 'container': name, 'remote': remote})
    created = False
    # Native SQLite backup API includes committed WAL data without stopping the
    # writer. Photos are immutable/synced before indexing, so a later photo copy
    # contains every referenced photo, possibly with harmless newer extras.
    with __import__('tempfile').TemporaryDirectory(prefix='homelab-hourly-') as temporary:
        raw = Path(temporary) / 'snapshot.sqlite'
        try:
            run(docker('services', 'exec', name, 'www-server', 'database-snapshot', remote),
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            created = True
            run(docker('services', 'cp', name + ':' + remote, str(raw)),
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        finally:
            if created:
                run(docker('services', 'exec', name, 'rm', '--', remote),
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                durable.remove(pending)
        spec = importlib.util.spec_from_file_location('sqlite_snapshot', Path(__file__).with_name('sqlite-snapshot.py'))
        sqlite_snapshot = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(sqlite_snapshot)
        sqlite_snapshot.snapshot_database(raw, destination / 'control-center.sqlite')
    container_files(destination / 'control-center-media.tar.gz', 'services', name, '/app/media')


def snapshot(destination, services, weekly_exports=False, control_center_online=False):
    os.umask(0o077)
    if destination.is_symlink() or destination.stat().st_uid != os.geteuid() or destination.stat().st_mode & 0o077:
        raise RuntimeError('Snapshot destination must be a private service-owned directory')
    if control_center_online and services != ['control-center']:
        raise ValueError('Online snapshots are restricted to the hourly Control Center scope')
    images = {}
    for service in services:
        runtime, names = NAMES[service]
        for name in names:
            # Record only image identity, never environment or full inspect output.
            result = run(docker(runtime, 'inspect', '--format', '{{.Image}}', name),
                         capture_output=True, text=True, timeout=30)
            image = result.stdout.strip()
            result = run(docker(runtime, 'image', 'inspect', '--format', '{{json .RepoDigests}}', image),
                         capture_output=True, text=True, timeout=30)
            images[name] = {'id': image, 'repo_digests': json.loads(result.stdout)}
    (destination / 'images.json').write_text(json.dumps(images, indent=2))
    if control_center_online:
        online_control_center(destination)
    elif 'control-center' in services:
        with stopped('services', 'www-control-center-www-1', destination):
            spec = importlib.util.spec_from_file_location('sqlite_snapshot', Path(__file__).with_name('sqlite-snapshot.py'))
            sqlite_snapshot = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(sqlite_snapshot)
            sqlite_snapshot.snapshot_container(destination / 'control-center.sqlite', docker, run)
            container_files(destination / 'control-center-media.tar.gz', 'services',
                            'www-control-center-www-1', '/app/media')
    if 'penpot' in services:
        # Freeze all app writers together so the database and asset store agree.
        with ExitStack() as stack:
            for name in NAMES['penpot'][1][:5]:
                stack.enter_context(stopped('services', name, destination))
            with (destination / 'penpot.dump').open('xb') as output:
                run(docker('services', 'exec', 'penpot-penpot-postgres-1',
                           'pg_dump', '-U', 'penpot', '-d', 'penpot', '-Fc'), stdout=output)
            with (destination / 'penpot.dump').open('rb') as source:
                run(docker('services', 'exec', '-i', 'penpot-penpot-postgres-1',
                           'pg_restore', '-l'), stdin=source, stdout=subprocess.DEVNULL)
            container_files(destination / 'penpot-assets.tar.gz', 'services',
                            'penpot-penpot-backend-1', '/opt/data/assets')
            with stopped('services', 'penpot-penpot-valkey-1', destination):
                container_files(destination / 'penpot-valkey.tar.gz', 'services',
                                'penpot-penpot-valkey-1', '/data')
    if 'home-assistant' in services:
        name = 'www-home-assistant-home-assistant-1'
        with stopped('ha', name, destination):
            container_files(destination / 'home-assistant-config.tar.gz', 'ha', name, '/config')
    if 'bambuddy' in services:
        with stopped('services', 'bambuddy', destination):
            container_files(destination / 'bambuddy-data.tar.gz', 'services', 'bambuddy', '/app/data')
            with stopped('services', 'bambu-studio-api', destination):
                container_files(destination / 'bambuddy-studio.tar.gz', 'services', 'bambu-studio-api', '/app/data')
            with stopped('services', 'bambuddy-tailscale', destination):
                container_files(destination / 'bambuddy-tailscale.tar.gz', 'services',
                                'bambuddy-tailscale', '/var/lib/tailscale')
    if 'hindsight' in services:
        helper = Path(__file__).with_name('hindsight-pg.py').read_text()
        output = destination / 'hindsight.dump'
        with output.open('wb') as target:
            run(docker('services', 'exec', 'hindsight', 'python3', '-c', helper, 'dump'), stdout=target)
        if not output.stat().st_size:
            raise RuntimeError('Hindsight dump is empty')
        with output.open('rb') as source:
            run(docker('services', 'exec', '-i', 'hindsight', 'python3', '-c', helper, 'verify'),
                stdin=source, stdout=subprocess.DEVNULL)
        # Preserve ancillary Codex state with a cold copy; PostgreSQL stays logical.
        with stopped('services', 'hindsight', destination):
            container_files(destination / 'hindsight-codex-home.tar.gz', 'services',
                            'hindsight', '/home/hindsight/.codex-hindsight')
            spec = importlib.util.spec_from_file_location('codex_archive', Path(__file__).with_name('sanitize-codex-archive.py'))
            codex_archive = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(codex_archive)
            sanitized = destination / 'hindsight-codex-home.sanitized.tar.gz'
            codex_archive.sanitize(destination / 'hindsight-codex-home.tar.gz', sanitized)
            # Only replace after complete validation; failed raw archives survive.
            os.replace(sanitized, destination / 'hindsight-codex-home.tar.gz')
        if weekly_exports:
            export_banks(destination)
    for service in services:
        runtime, names = NAMES[service]
        for name in names:
            healthy(runtime, name)
