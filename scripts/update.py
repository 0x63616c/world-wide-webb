#!/usr/bin/env python3
"""Root-owned, exact-main deployment agent. Never used during repository authoring."""
import argparse
from contextlib import contextmanager
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import urllib.parse
import urllib.request

REPO = '0x63616c/homelab'


def load_sibling(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


operations = load_sibling('operations', 'operation-lock.py')
service_child = load_sibling('service_child', 'service-child.py')
durable = load_sibling('durable', 'durable.py')


def run(*args, **kwargs):
    kwargs.setdefault('timeout', 600)
    if kwargs.pop('supervise', False):
        timeout = kwargs.pop('timeout')
        process = subprocess.Popen(args, text=True, start_new_session=True, **kwargs)
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
            raise subprocess.CalledProcessError(result, args)
        return subprocess.CompletedProcess(args, result)
    return subprocess.run(args, check=True, text=True, **kwargs)


def eligible(runs, sha):
    """Only the latest push run for this exact main SHA authorizes activation."""
    matching = [r for r in runs if r.get('head_sha') == sha
                and r.get('head_branch') == 'main' and r.get('event') == 'push']
    if not matching:
        return False
    latest = max(matching, key=lambda r: (r['run_number'], r.get('run_attempt', 1)))
    return latest.get('status') == 'completed' and latest.get('conclusion') == 'success'


def write_state(path, value):
    durable.write_json(path, value)


@contextmanager
def git_credentials(root, token_file):
    """Askpass reads a protected file; no token in argv, URLs, or Git config."""
    with tempfile.TemporaryDirectory(prefix='git-auth-', dir=root) as directory:
        helper = Path(directory) / 'askpass'
        helper.write_text('#!/bin/sh\ncase "$1" in\n'
                          '  *Username*) printf "%s\\n" x-access-token ;;\n'
                          '  *) cat "$HOMELAB_GITHUB_TOKEN_FILE" ;;\nesac\n')
        helper.chmod(0o700)
        env = dict(os.environ, GIT_ASKPASS=str(helper), GIT_TERMINAL_PROMPT='0',
                   HOMELAB_GITHUB_TOKEN_FILE=str(token_file),
                   GIT_CONFIG_COUNT='1', GIT_CONFIG_KEY_0='credential.helper',
                   GIT_CONFIG_VALUE_0='')
        yield env


def recover_interrupted(root, state, operation_root=None):
    """An interrupted switch needs inspection; do not guess about data migrations."""
    if state.get('result') in ('backing-up', 'activating', 'reconciling', 'rolling-back'):
        durable.hold(root / 'hold', mode=0o600)
        if operation_root is not None:
            durable.hold(operation_root / 'hold', mode=0o644)
        write_state(root / 'status.json', {**state, 'result': 'interrupted-needs-review'})
        return True
    return False


def activate(root, state, sha, system, previous, health_command=None, *,
             reconcile=None, health=None, on_failure=None, activation_fd=None):
    profile = '/nix/var/nix/profiles/system'
    statefile = root / 'status.json'
    transaction = {**state, 'desired': sha, 'previousSystem': str(previous)}
    write_state(statefile, {**transaction, 'result': 'activating'})
    services_started = False
    try:
        run('nix-env', '--profile', profile, '--set', str(system))
        run(str(system / 'activate'), supervise=True,
            pass_fds=() if activation_fd is None else (activation_fd,))
        if reconcile is not None:
            services_started = True
            write_state(statefile, {**transaction, 'currentSystem': str(system), 'result': 'reconciling'})
            reconcile()
        if health is not None:
            health()
        else:
            run(health_command, timeout=180)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError, RuntimeError, ValueError):
        # Set the persistent hold BEFORE attempting rollback: recovery can also fail.
        durable.hold(root / 'hold', mode=0o600)
        if on_failure is not None:
            on_failure()
        if services_started:
            # New applications may already have migrated their databases.
            # Never activate the old application generation against that state.
            write_state(statefile, {**transaction, 'failed': sha, 'currentSystem': str(system),
                                   'result': 'service-failed-needs-recovery'})
            raise
        failed = {**transaction, 'failed': sha, 'result': 'rolling-back'}
        write_state(statefile, failed)
        try:
            run('nix-env', '--profile', profile, '--set', str(previous))
            run(str(previous / 'activate'), supervise=True,
                pass_fds=() if activation_fd is None else (activation_fd,))
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError, RuntimeError, ValueError):
            write_state(statefile, {**failed, 'result': 'rollback-failed'})
            raise
        write_state(statefile, {**failed, 'result': 'activation-failed-rolled-back'})
        raise
    write_state(statefile, {'desired': sha, 'deployed': sha,
                           'previousSystem': str(previous), 'result': 'healthy'})


def deployment_transaction(root, state, sha, system, previous, operation_root=None):
    operation_root = operations.ROOT if operation_root is None else operation_root
    old = json.loads((previous / 'etc/homelab/deployment.json').read_text())
    new = json.loads((system / 'etc/homelab/deployment.json').read_text())
    updater_plist = Path('Library/LaunchDaemons/org.homelab.update.plist')
    if (previous / updater_plist).read_bytes() != (system / updater_plist).read_bytes():
        raise ValueError('Updater supervision changes require a manual activation')
    if old['host'] != new['host'] or old['services'] != new['services']:
        raise ValueError('Host/service ownership changes require the migration workflow')
    has_services = bool(old['services'])
    if has_services and not (old['backupsEnabled'] and new['backupsEnabled']):
        raise ValueError('Stateful updates require verified backups in both generations')
    with operations.operation_lock(operation_root) as descriptor:
        write_state(operation_root / 'transaction', {'desired': sha, 'previousSystem': str(previous)})
        hold = lambda: durable.hold(operation_root / 'hold', mode=0o644)
        if has_services:
            write_state(root / 'status.json', {**state, 'desired': sha, 'result': 'backing-up'})
            try:
                service_child.run_service('backup', descriptor, 7200, system=previous)
            except (subprocess.SubprocessError, OSError, RuntimeError, ValueError):
                durable.hold(root / 'hold', mode=0o600)
                hold()
                write_state(root / 'status.json', {**state, 'desired': sha, 'failed': sha,
                                                   'result': 'backup-failed-needs-review'})
                raise
        activate(root, state, sha, system, previous,
                 reconcile=(lambda: service_child.run_service('reconcile', descriptor, 1800, system=system))
                 if has_services else None,
                 health=lambda: service_child.run_service('health', descriptor, 180, system=system),
                 on_failure=hold, activation_fd=descriptor)
        durable.remove(operation_root / 'transaction')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', required=True, choices=['homelab-macbook', 'homelab-mac-mini'])
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('Must run as root')
    root = Path('/var/lib/homelab')
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if root.stat().st_uid != 0 or root.stat().st_mode & 0o022:
        raise SystemExit('Updater state must be root-owned and not group/world writable')
    durable.sync_directory(root.parent)
    with (root / 'update.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        statefile = root / 'status.json'
        state = json.loads(statefile.read_text()) if statefile.exists() else {}
        if recover_interrupted(root, state, operations.ROOT):
            return
        if (operations.ROOT / 'transaction').exists():
            durable.hold(root / 'hold', mode=0o600)
            durable.hold(operations.ROOT / 'hold', mode=0o644)
            write_state(statefile, {**state, 'result': 'interrupted-needs-review'})
            return
        # A maintenance hold is an explicit local intervention, not removed by Git.
        if (root / 'hold').exists():
            return
        token_file = Path('/run/secrets/github-read-token')
        token = token_file.read_text().strip()
        if not token:
            raise SystemExit('GitHub credential empty')
        checkout = root / 'checkout'
        with git_credentials(root, token_file) as git_env:
            if not (checkout / '.git').exists():
                run('git', 'clone', '--no-checkout', f'https://github.com/{REPO}.git',
                    str(checkout), env=git_env)
            run('git', '-C', str(checkout), 'fetch', '--no-tags', 'origin',
                '+refs/heads/main:refs/remotes/origin/main', env=git_env)
        sha = run('git', '-C', str(checkout), 'rev-parse', 'refs/remotes/origin/main',
                  capture_output=True).stdout.strip()
        if not re.fullmatch(r'[0-9a-f]{40}', sha):
            raise SystemExit('Invalid main revision')
        if sha in [state.get('deployed'), state.get('failed')]:
            return
        query = urllib.parse.urlencode({'head_sha': sha, 'branch': 'main', 'event': 'push', 'per_page': 100})
        url = f'https://api.github.com/repos/{REPO}/actions/workflows/check.yml/runs?{query}'
        request = urllib.request.Request(url, headers={
            'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json',
            'User-Agent': 'homelab-updater',
        })
        with urllib.request.urlopen(request, timeout=30) as response:
            runs = json.load(response)['workflow_runs']
        if not eligible(runs, sha):
            write_state(statefile, {**state, 'desired': sha, 'result': 'awaiting-ci'})
            return
        run('git', '-C', str(checkout), 'checkout', '--detach', '--force', sha)
        run('git', '-C', str(checkout), 'clean', '-fdx')
        # Keep the candidate GC-rooted throughout activation and recovery.
        output = run('nix', 'build', '--out-link', str(root / 'candidate-system'),
                     '--json', '--no-update-lock-file',
                     f'{checkout}#darwinConfigurations.{args.host}.system', capture_output=True, timeout=3600)
        system = Path(json.loads(output.stdout)[0]['outputs']['out'])
        previous = Path('/run/current-system').resolve(strict=True)
        plist = Path('Library/LaunchDaemons/org.homelab.update.plist')
        if (Path('/') / plist).read_bytes() != (previous / plist).read_bytes():
            raise SystemExit('Installed updater supervision differs from the active generation; manual review required')
        try:
            deployment_transaction(root, state, sha, system, previous)
        except operations.OperationDeferred:
            return


if __name__ == '__main__':
    main()
