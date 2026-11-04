#!/usr/bin/env python3
"""Scheduled snapshot + verified NAS copy; invoked beneath homelab-operation."""
import argparse
import datetime
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import uuid

import snapshot

spec = importlib.util.spec_from_file_location('nas_upload', Path(__file__).with_name('nas-upload.py'))
upload = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upload)
verify_spec = importlib.util.spec_from_file_location('verify_backup', Path(__file__).with_name('verify-backup.py'))
verifier = importlib.util.module_from_spec(verify_spec)
verify_spec.loader.exec_module(verifier)


def verified_copy(destination, remote, nas):
    records = []
    # COMPLETE is created only after every payload passes read-back verification.
    for path in sorted(destination.iterdir()):
        if not path.is_file() or path.is_symlink():
            raise RuntimeError('Unexpected snapshot payload')
        records.append(nas.upload(path, remote))
    complete = destination / 'COMPLETE.json'
    complete.write_text(json.dumps({'format': 1, 'files': records}, indent=2))
    # A valid upload is not enough: the set must contain all assigned service
    # state and valid recovery metadata before publishing its completion marker.
    verifier.verify(destination)
    # Publishing completion must not hide a service that failed to recover
    # after its snapshot, including a running but disconnected tunnel/sidecar.
    snapshot.run(['/run/current-system/sw/bin/homelab-health'], timeout=150)
    nas.upload(complete, remote)
    (destination / 'NAS_VERIFIED').touch(mode=0o600)


def prune_verified(root, keep):
    if keep < 1:
        raise ValueError('Must retain at least one verified local set')
    completed = sorted(path for path in root.iterdir()
                       if re.fullmatch(r'\d{8}T\d{6}Z-[a-f0-9]{8}', path.name)
                       and path.is_dir() and not path.is_symlink()
                       and (path / 'NAS_VERIFIED').is_file()
                       and not (path / 'NAS_VERIFIED').is_symlink())
    for old in completed[:-keep]:
        shutil.rmtree(old)


def recovery_bundle(destination, services, configuration):
    # Includes plaintext service credentials: destination and archives are private.
    staging = destination / 'recovery'
    staging.mkdir(mode=0o700)
    try:
        (staging / 'host.json').write_text(json.dumps({
            'host': configuration['host'], 'services': services,
            'system_path': os.path.realpath('/run/current-system'),
            'weeklyHindsightExport': configuration.get('weeklyHindsightExport', False),
        }, indent=2))
        for service in services:
            source = Path('/etc/homelab/services') / service
            if service == 'home-assistant':
                source = Path('/etc/homelab/home-assistant')
            shutil.copytree(source, staging / 'compose' / service)
            if service != 'home-assistant':
                shutil.copytree(Path('/var/lib/_containers/runtime-secrets') / service,
                                staging / 'credentials' / service)
        if any(service != 'home-assistant' for service in services):
            shutil.copyfile('/run/secrets/containers-env', staging / 'containers.env')
        snapshot.run(['tar', '-czf', str(destination / 'recovery.tar.gz'),
                      '-C', str(staging), '.'])
    finally:
        shutil.rmtree(staging)


def backup(config):
    os.umask(0o077)
    root = Path(config['root'])
    root.mkdir(mode=0o700, exist_ok=True)
    if root.is_symlink() or root.stat().st_uid != os.geteuid() or root.stat().st_mode & 0o077:
        raise RuntimeError('Backup root must be private and service-owned')
    snapshot.durable.sync_directory(root.parent)
    if list(root.glob('*/*.restart-required')):
        raise RuntimeError('An earlier snapshot needs service recovery inspection')
    if shutil.disk_usage(root).free < config['minFreeGiB'] * 1024 ** 3:
        raise RuntimeError('Insufficient free space for backup admission')
    services = config['services']
    if not services or set(services) - snapshot.NAMES.keys():
        raise ValueError('Invalid or empty backup service assignment')
    credentials = Path('/run/secrets/nas-backup-credentials')
    if credentials.stat().st_mode & 0o077:
        raise RuntimeError('NAS credentials must be private')
    nas = upload.Nas(json.loads(credentials.read_text()))
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    stamp += '-' + uuid.uuid4().hex[:8]
    destination = root / stamp
    destination.mkdir(mode=0o700)
    snapshot.durable.sync_directory(root)
    remote = '/Homelab/backups/' + config['host'] + '/' + stamp
    if not upload.valid_destination(remote):
        raise ValueError('Invalid host backup namespace')
    weekly = 'hindsight' in services and datetime.datetime.now().weekday() == 6
    config = {**config, 'weeklyHindsightExport': weekly}
    snapshot.snapshot(destination, services, weekly_exports=weekly)
    recovery_bundle(destination, services, config)
    try:
        nas.login()
        verified_copy(destination, remote, nas)
    finally:
        nas.logout()
    if weekly:
        retain_weekly(root, destination)
    prune_verified(root, config['keepLocal'])
    print('Backup verified: ' + stamp, flush=True)


def retain_weekly(root, destination):
    """Keep the first verified export from each of eight local calendar weeks."""
    weekly = root / 'weekly-exports'
    weekly.mkdir(mode=0o700, exist_ok=True)
    if weekly.is_symlink() or weekly.stat().st_uid != os.geteuid() or weekly.stat().st_mode & 0o077:
        raise ValueError('Weekly export directory must be private')
    if not (destination / 'NAS_VERIFIED').is_file():
        raise ValueError('Only verified exports may enter retention')
    if not re.fullmatch(r'\d{8}T\d{6}Z-[a-f0-9]{8}', destination.name):
        raise ValueError('Invalid weekly snapshot name')
    timestamp = datetime.datetime.strptime(destination.name[:16], '%Y%m%dT%H%M%SZ')
    local_time = timestamp.replace(tzinfo=datetime.timezone.utc).astimezone()
    year, week, _ = local_time.isocalendar()
    target = weekly / f'{year}-W{week:02}.tar.gz'
    if target.exists() or target.is_symlink():
        if target.is_symlink() or not target.is_file() or target.stat().st_mode & 0o077:
            raise ValueError('Unsafe existing weekly export')
        # Repeated deployments on Sunday must not displace previous weeks.
        return
    # Publish only a fully copied file; link refuses replacing a previous set.
    with (destination / 'hindsight-bank-exports.tar.gz').open('rb') as source, tempfile.NamedTemporaryFile(
            dir=weekly, prefix='.partial-') as output:
        shutil.copyfileobj(source, output)
        output.flush()
        os.fsync(output.fileno())
        os.link(output.name, target)
    completed = sorted(path for path in weekly.iterdir()
                       if re.fullmatch(r'\d{4}-W\d{2}\.tar\.gz', path.name)
                       and path.is_file() and not path.is_symlink())
    for old in completed[:-8]:
        old.unlink()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, required=True)
    args = parser.parse_args()
    if os.geteuid() == 0:
        raise RuntimeError('Backup must run as _containers, never root')
    backup(json.loads(args.config.read_text()))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Network and application exceptions can carry sensitive data.
        print('Backup failed: ' + type(error).__name__ + '; local set retained', file=sys.stderr)
        sys.exit(1)
