#!/usr/bin/env python3
"""Check the exact canary implementation against successful main Homelab CI."""

import json
import os
from pathlib import Path
import re
import subprocess
import sys

from deliver import ROOT, api, inputs, validate_ci
from promotion import REPOSITORY


def checked(run_id, source):
    if not re.fullmatch(r'[1-9]\d*', run_id):
        raise ValueError('Expected a CI run ID')
    run = api(f'actions/runs/{run_id}')
    jobs = []
    for page in range(1, 11):
        batch = api(f"actions/runs/{run_id}/attempts/{run['run_attempt']}/jobs?per_page=100&page={page}")['jobs']
        jobs.extend(batch)
        if len(batch) < 100:
            break
    else:
        raise ValueError('CI job inventory exceeds the allowed bound')
    configuration = json.loads((ROOT / 'scripts/ci/units.json').read_text())
    intent = {'source': source, 'run_id': int(run_id), 'attempt': run['run_attempt'],
              'inputs': inputs.input_hash('homelab.config', source, ROOT, configuration)}
    # A deliberate full main CI dispatch is useful when app-only main changes
    # did not select host checks. Every named host check must still succeed.
    validate_ci(intent, run, jobs, allow_manual=True)
    return source


def main():
    source = os.environ['GITHUB_SHA']
    if os.environ.get('GITHUB_REPOSITORY') != REPOSITORY or os.environ.get('GITHUB_REF') != 'refs/heads/main':
        raise ValueError('Operations canary requires this repository main')
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    if actual != source:
        raise ValueError('Canary checkout does not match its workflow source')
    checked(sys.argv[1], source)
    with Path(os.environ['GITHUB_OUTPUT']).open('a') as output:
        output.write(f'sha={source}\n')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, OSError, KeyError, IndexError, TypeError, subprocess.SubprocessError):
        raise SystemExit('Exact-source operations CI was not confirmed; canary stays disabled') from None
