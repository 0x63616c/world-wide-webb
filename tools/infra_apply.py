#!/usr/bin/env python3
"""Apply tested HCL on the mini using OpenTofu's encrypted state and native lock.

No backend service, app container or plaintext state artifact is involved.
Bootstrap imports and recovery credentials live outside this checkout.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def safe_plan(plan):
    # Removing the explicitly retired app hostname is allowed; retained services
    # and the shared tunnel may not be destroyed by an automatic release.
    retired = {'cloudflare_dns_record.home["app"]',
               'cloudflare_zero_trust_access_application.home["app"]'}
    for change in plan.get('resource_changes', []):
        if 'delete' in change.get('change', {}).get('actions', []) and change['address'] not in retired:
            raise RuntimeError('automatic apply would destroy retained infrastructure')


def main():
    os.umask(0o077)
    source = Path(sys.argv[1]).resolve()
    home = Path(os.environ.get('WWW_INFRA_ROOT', str(Path.home() / 'homelab-infra/cloudflare')))
    state = home / 'cloudflare.tfstate'
    variables = home / 'production.tfvars.json'
    if not state.is_file() or not variables.is_file():
        raise RuntimeError('import and verify existing infrastructure before enabling automatic apply')
    env = dict(os.environ)
    env['TF_VAR_state_passphrase'] = (home / 'secrets/STATE_PASSPHRASE').read_text().strip()
    env['CLOUDFLARE_API_TOKEN'] = (home / 'secrets/CF_API_TOKEN').read_text().strip()
    binary = os.environ.get('OPENTOFU_BIN', '/opt/homebrew/bin/tofu')
    version = json.loads(subprocess.check_output([binary, 'version', '-json'], env=env))['terraform_version']
    if version != (source / '.opentofu-version').read_text().strip():
        raise RuntimeError('install the pinned OpenTofu version before applying')
    evidence = home / 'evidence'
    evidence.mkdir(exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    with (evidence / f'apply-{stamp}-{os.getpid()}.log').open('xb') as log:
        def run(*args, capture=False):
            return subprocess.check_output([binary, '-chdir=' + str(source), *args], env=env, stderr=log) if capture else subprocess.run([binary, '-chdir=' + str(source), *args], env=env, stdout=log, stderr=log, check=True)
        run('init', '-input=false', '-lockfile=readonly', '-backend-config=path=' + str(state))
        with tempfile.TemporaryDirectory(prefix='plan-', dir=home) as scratch:
            plan = str(Path(scratch) / 'cloudflare.plan')
            run('plan', '-input=false', '-lock-timeout=120s', '-var-file=' + str(variables), '-out=' + plan)
            safe_plan(json.loads(run('show', '-json', plan, capture=True)))
            backups = home / 'state-backups'
            backups.mkdir(exist_ok=True)
            backup = backups / f'{stamp}-{os.getpid()}.tfstate'
            shutil.copyfile(state, backup)
            if hashlib.sha256(state.read_bytes()).digest() != hashlib.sha256(backup.read_bytes()).digest():
                raise RuntimeError('encrypted state backup did not verify')
            run('apply', '-input=false', '-lock-timeout=120s', plan)
    print('Applied tested Cloudflare configuration; encrypted recovery evidence retained')


if __name__ == '__main__':
    main()
