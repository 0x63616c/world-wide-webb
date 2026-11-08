#!/usr/bin/env python3
"""Serialize a complete Darwin generation change with backup and health gates.

Failure leaves a durable transaction marker and private diagnostics for explicit
recovery. Never roll back application data or restart a stale generation blindly.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import uuid

import durable


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


locks = load('operation_lock', 'operation-lock.py')
children = load('service_child', 'service-child.py')
ROOT = Path('/var/lib/homelab-operations')
CURRENT = Path('/run/current-system')
PROFILE = Path('/nix/var/nix/profiles/system')


def system_path(path):
    resolved = path.resolve(strict=True)
    if resolved.parent != Path('/nix/store') or not resolved.is_dir():
        raise ValueError('Expected a built Nix system')
    for relative in ['activate', 'activate-user', 'etc/homelab/deployment.json']:
        if not (resolved / relative).is_file():
            raise ValueError('Incomplete Nix system')
    return resolved


def metadata(system):
    data = json.loads((system / 'etc/homelab/deployment.json').read_text())
    if not isinstance(data, dict) or not isinstance(data.get('services'), list):
        raise ValueError('Invalid deployment metadata')
    services = data['services']
    if any(not isinstance(s, str) for s in services) or len(set(services)) != len(services):
        raise ValueError('Invalid service assignment')
    if services and data.get('backupsEnabled') is not True:
        raise ValueError('Stateful updates require configured backups')
    return data


def run(command, env, log, timeout=1800):
    process = subprocess.Popen(command, env=env, cwd='/', stdin=subprocess.DEVNULL,
                               stdout=log, stderr=log, start_new_session=True,
                               pass_fds=(int(env['HOMELAB_OPERATION_FD']),))
    try:
        result = process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        raise
    if result:
        raise RuntimeError('Generation command failed; inspect private activation diagnostics')


def activate(candidate, fd, token, log):
    env = {'PATH': '/nix/var/nix/profiles/default/bin:/usr/bin:/bin:/usr/sbin:/sbin',
           'HOME': '/var/root', 'USER': 'root', 'LOGNAME': 'root',
           'HOMELAB_OPERATION_FD': str(fd), 'HOMELAB_TRANSACTION': token}
    run(['/nix/var/nix/profiles/default/bin/nix-env', '--profile', str(PROFILE),
         '--set', str(candidate)], env, log, timeout=180)
    run([str(candidate / 'activate-user')], env, log)
    # Generated activate has an `env -i` shebang. Invoke its pinned interpreter
    # directly to preserve only our explicitly constructed transaction context.
    interpreter = (candidate / 'activate').read_text().splitlines()[0].split()[-1]
    if not interpreter.startswith('/nix/store/') or not interpreter.endswith('/bin/bash'):
        raise ValueError('Unexpected activation interpreter')
    run([interpreter, str(candidate / 'activate')], env, log)


def transaction(candidate, previous, root, fd, backup, switch, reconcile):
    old, new = metadata(previous), metadata(candidate)
    if old.get('host') != new.get('host'):
        raise ValueError('Candidate host differs from the running host')
    if set(old['services']) - set(new['services']):
        raise ValueError('Service removal needs an explicit source-stopped retirement workflow')
    token = uuid.uuid4().hex
    journal = root / 'transaction'
    record = {'format': 1, 'id': token, 'previous': str(previous),
              'candidate': str(candidate), 'phase': 'backup'}
    durable.write_json(journal, record)
    # Failure deliberately retains the journal. It is neither a retry flag nor
    # permission to bypass backup/recovery by deleting it.
    if old['services']:
        backup(previous, fd)
    record['phase'] = 'activation'
    durable.write_json(journal, record)
    switch(candidate, fd, token)
    record['phase'] = 'reconcile'
    durable.write_json(journal, record)
    if new['services']:
        reconcile(candidate, fd)
    record['phase'] = 'verified'
    durable.write_json(root / 'last-success.json', record)
    durable.remove(journal)
    return record


def guard(candidate, root=ROOT, current=CURRENT, profile=PROFILE):
    journal = root / 'transaction'
    if journal.exists():
        record = json.loads(journal.read_text())
        token = os.environ.get('HOMELAB_TRANSACTION')
        value = os.environ.get('HOMELAB_OPERATION_FD', '')
        if (record.get('candidate') != str(candidate) or record.get('id') != token
                or not value.isdecimal() or int(value) < 3):
            raise RuntimeError('Interrupted or unowned activation transaction requires inspection')
        with locks.operation_lock(root, inherited_fd=int(value)):
            return
    # Boot reapplies the already committed generation. It is not a new update.
    if current.exists():
        raise RuntimeError('Use homelab-activate-generation apply for stateful activation')
    receipt = json.loads((root / 'last-success.json').read_text())
    if (receipt.get('phase') != 'verified' or receipt.get('candidate') != str(candidate)
            or profile.resolve(strict=True) != candidate):
        raise RuntimeError('Boot generation has no verified activation receipt')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['apply', 'guard'])
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--operation', dest='switch_operation', default='switch')
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error('Only root may activate a system generation')
    candidate = system_path(args.candidate)
    if args.operation == 'guard':
        guard(candidate)
        return
    if args.switch_operation != 'switch':
        parser.error('Stateful Darwin deployment supports switch only')
    locks.initialize(ROOT)
    # Detach from Comin's process group. Its launchd job also abandons child
    # process groups so an updater replacement cannot kill this lock owner.
    try:
        os.setsid()
    except PermissionError:
        if os.getpgrp() != os.getpid():
            raise
    with locks.operation_lock(ROOT) as fd:
        previous = system_path(CURRENT)
        if PROFILE.resolve(strict=True) != previous:
            raise RuntimeError('Current system and boot profile differ; inspect before another update')
        os.umask(0o077)
        with (ROOT / 'activation.log').open('a') as log:
            os.chmod(ROOT / 'activation.log', 0o600)
            transaction(candidate, previous, ROOT, fd,
                        lambda old, lock: children.run_service('backup', lock, 3600, system=old, log=log),
                        lambda new, lock, token: activate(new, lock, token, log),
                        lambda new, lock: children.run_service('reconcile', lock, 1800, system=new, log=log))
    print('Generation activated and assigned services verified.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError, locks.OperationDeferred):
        print('Stateful activation did not complete. Preserve its transaction and inspect recovery state.', file=sys.stderr)
        raise SystemExit(1)
