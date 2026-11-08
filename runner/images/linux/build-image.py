#!/usr/bin/env python3
"""Build a disposable Tart Linux image from reviewed source and publish it to OCI.

Run from the repository root on an Apple silicon Mac with Tart 2.41.1. Only
trusted image provisioning runs in this VM; job VMs use the controller's Softnet
policy. Registry login happens on the host; credentials are never copied in.
"""
import argparse
import contextlib
import hashlib
import io
import json
import os
import pathlib
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid

BASE = 'ghcr.io/cirruslabs/ubuntu@sha256:97166c84ea5f102be33d2959f70e83861a36bd749f1715ab669d93e6c9f31476'


@contextlib.contextmanager
def build_home():
    home = pathlib.Path(tempfile.mkdtemp(prefix='homelab-linux-image-'))
    try:
        yield str(home)
    finally:
        if (home / '.running').exists():
            print(f'VM stop is unconfirmed; preserve and reconcile {home}')
        else:
            shutil.rmtree(home)


def build(destination, output, cache_bundle=None):
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise RuntimeError('image builds require an Apple silicon Mac')
    if shutil.disk_usage(pathlib.Path.home()).free < 20 * 1024 ** 3:
        raise RuntimeError('image build requires at least 20 GiB free')
    if not destination.startswith('ghcr.io/') or '@' in destination or ':' not in destination:
        raise RuntimeError('destination must be an explicit GHCR tag')
    source = pathlib.Path('runner').resolve()
    if not (source / 'Cargo.lock').is_file():
        raise RuntimeError('run from the reviewed repository root')
    env = {key: os.environ[key] for key in ('HOME', 'PATH') if key in os.environ}
    source_revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], env=env, text=True).strip()
    if subprocess.check_output(['git', 'status', '--porcelain'], env=env, text=True).strip():
        raise RuntimeError('commit the reviewed source before building an image')
    tart = shutil.which('tart')
    if not tart:
        raise RuntimeError('Tart is required')
    version = subprocess.check_output([tart, '--version'], env=env, text=True).strip()
    if version not in ('2.41.1', 'tart 2.41.1'):
        raise RuntimeError('reviewed Tart 2.41.1 is required')
    vm = 'homelab-linux-image-' + uuid.uuid4().hex
    process = None
    # Use a separate cache, never the production runner's VM inventory.
    with build_home() as home:
        env['TART_HOME'] = home
        env['TART_NO_AUTO_PRUNE'] = '1'

        def call(*args, data=None, seconds=600, check=True, command_env=None):
            return subprocess.run([tart, *args], env=env if command_env is None else command_env, input=data,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  timeout=seconds, check=check)

        def guest(*args, data=None, seconds=30, check=True):
            flags = ['exec'] + (['-i'] if data is not None else [])
            return call(*flags, vm, *args, data=data, seconds=seconds, check=check)

        try:
            call('clone', BASE, vm)
            call('set', vm, '--cpu', '2', '--memory', '4096', '--disk-size', '24')
            with open(pathlib.Path(home) / 'boot.log', 'wb') as log:
                (pathlib.Path(home) / '.running').touch()
                process = subprocess.Popen([tart, 'run', '--no-graphics', '--no-clipboard',
                                            '--no-audio', '--no-usb-accessories', vm],
                                           env=env, stdout=log, stderr=log)
                deadline = time.monotonic() + 600
                while True:
                    if process.poll() is not None:
                        raise RuntimeError('image VM exited during boot')
                    try:
                        uid = guest('/usr/bin/id', '-u').stdout.strip()
                        if uid != b'1000':
                            raise RuntimeError('base image identity mismatch')
                        break
                    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                        if time.monotonic() >= deadline:
                            raise RuntimeError('guest RPC boot deadline exceeded')
                        time.sleep(2)
                guest('/bin/mkdir', '-p', '/home/admin/runner-source')
                archive = io.BytesIO()
                with tarfile.open(fileobj=archive, mode='w:gz') as tar:
                    for item in sorted(source.rglob('*')):
                        relative = item.relative_to(source)
                        if any(part in ('target', '.git', '.DS_Store') for part in relative.parts):
                            continue
                        if item.is_symlink():
                            raise RuntimeError('runner source must not contain symlinks')
                        tar.add(item, arcname=str(relative), recursive=False)
                guest('/usr/bin/tar', '-xzf', '-', '-C', '/home/admin/runner-source',
                      data=archive.getvalue(), seconds=120)
                guest('/usr/bin/sudo', '-n', '/usr/bin/systemd-run', '--unit=homelab-image-build',
                      '--uid=admin', '--gid=admin', '--setenv=HOME=/home/admin', '/bin/bash',
                      '/home/admin/runner-source/images/linux/provision.sh')
                deadline = time.monotonic() + 1800
                while True:
                    status = guest('/usr/bin/systemctl', 'show', 'homelab-image-build.service',
                                   '--property=ActiveState,Result,ExecMainStatus').stdout.decode()
                    fields = dict(line.split('=', 1) for line in status.splitlines() if '=' in line)
                    if fields.get('ActiveState') in ('inactive', 'failed'):
                        if fields.get('Result') != 'success' or fields.get('ExecMainStatus') != '0':
                            raise RuntimeError('image provisioning failed; inspect guest build journal')
                        break
                    if time.monotonic() >= deadline:
                        raise RuntimeError('image provisioning exceeded 30 minutes')
                    time.sleep(5)
                helper = guest('/usr/local/libexec/homelab-runner-guest', '--version').stdout.decode().strip()
                guest('/usr/bin/sudo', '-n', '/usr/bin/sync')
                try:
                    guest('/usr/bin/sudo', '-n', '/usr/bin/systemctl', 'poweroff')
                except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                    pass  # Poweroff may close RPC before its reply. Reap the exact VM below.
                process.wait(timeout=60)
                if process.returncode != 0:
                    raise RuntimeError('image VM did not shut down cleanly')
            # Only publication gets registry credentials. The VM process and
            # every guest command above run with the restricted environment.
            publish_env = dict(env)
            for key in ('TART_REGISTRY_HOSTNAME', 'TART_REGISTRY_USERNAME', 'TART_REGISTRY_PASSWORD'):
                if key in os.environ:
                    publish_env[key] = os.environ[key]
            pushed = call('push', '--populate-cache', '--label',
                          'org.opencontainers.image.source=https://github.com/0x63616c/homelab',
                          '--label', 'org.opencontainers.image.revision=' + source_revision,
                          vm, destination, seconds=1200,
                          command_env=publish_env)
            secret = publish_env.pop('TART_REGISTRY_PASSWORD', '')
            if secret:
                pushed.stdout = pushed.stdout.replace(secret.encode(), b'[redacted]')
            del secret, publish_env
            print(pushed.stdout.decode(), end='')
            # Pinned Tart populates its digest-addressed cache after a successful push.
            namespace = destination.rsplit(':', 1)[0]
            cache = pathlib.Path(home) / 'cache/OCIs' / namespace
            digests = [entry.name for entry in cache.iterdir()
                       if entry.name.startswith('sha256:') and not entry.is_symlink()]
            if len(digests) != 1 or len(digests[0]) != 71:
                raise RuntimeError('published image digest is ambiguous; do not promote the tag')
            immutable = namespace + '@' + digests[0]
            output.write_text(json.dumps({'base': BASE, 'destination': destination, 'image': immutable,
                                          'tart': version, 'helper': helper, 'source_revision': source_revision,
                                          'cargo_lock_sha256': hashlib.sha256((source / 'Cargo.lock').read_bytes()).hexdigest(),
                                          'push_output': pushed.stdout.decode()[-4096:]}, indent=2) + '\n')
            if cache_bundle:
                subprocess.run([sys.executable, str(source / 'images/linux/cache-image.py'), 'pack',
                                '--tart-home', home, '--image', immutable,
                                '--bundle', str(pathlib.Path(cache_bundle).resolve())], env=env, check=True)
        finally:
            if process is not None and process.poll() is None:
                call('stop', vm, check=False, seconds=60)
                process.wait(timeout=60)
            # A surviving process or failed reap leaves the marker and cache intact.
            (pathlib.Path(home) / '.running').unlink(missing_ok=True)
            call('delete', vm, check=False, seconds=60)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', required=True)
    parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path('linux-image-build.json'))
    parser.add_argument('--cache-bundle', type=pathlib.Path, help='optional verified offline cache bundle for the host')
    args = parser.parse_args()
    build(args.destination, args.output, args.cache_bundle)
