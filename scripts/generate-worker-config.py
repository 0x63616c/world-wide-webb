#!/usr/bin/env python3
"""Generate Wrangler bindings from `tofu output -json application_bindings` on stdin.

Apple and Access configuration is supplied in a public JSON file. Secrets are installed
separately with Wrangler secret bindings; never pass credentials in this document.
"""
import argparse
import json
import pathlib
import re
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--configuration', type=pathlib.Path, required=True)
parser.add_argument('--output', type=pathlib.Path, required=True)
args = parser.parse_args()
bindings = json.load(sys.stdin)
configuration = json.loads(args.configuration.read_text())
environment = bindings['environment']
if environment not in ('staging', 'production'):
    raise SystemExit('Invalid environment')
allowed = {
    'APPLE_SIGN_IN_TEAM_ID', 'APPLE_SIGN_IN_KEY_ID', 'APP_ATTEST_ENVIRONMENT',
    'APP_ATTEST_BUNDLE_VERSIONS', 'ACCESS_TEAM_DOMAIN', 'WORKER_VERSION',
}
if set(configuration) != allowed:
    raise SystemExit('Configuration must contain exactly: ' + ', '.join(sorted(allowed)))
if any(not isinstance(value, str) or not value for value in configuration.values()):
    raise SystemExit('Configuration values must be nonempty strings')
if not re.fullmatch(r'[0-9a-f]{40}', configuration['WORKER_VERSION']):
    raise SystemExit('WORKER_VERSION must identify the exact Git commit')
versions = json.loads(configuration['APP_ATTEST_BUNDLE_VERSIONS'])
if not isinstance(versions, list) or not versions or not all(isinstance(v, str) and v for v in versions):
    raise SystemExit('Explicit allowed App Attest build versions are required')
if configuration['APP_ATTEST_ENVIRONMENT'] not in ('development', 'production'):
    raise SystemExit('Invalid App Attest environment')
if environment == 'production' and configuration['APP_ATTEST_ENVIRONMENT'] != 'production':
    raise SystemExit('Production requires production App Attest')
if not re.fullmatch(r'https://[a-zA-Z0-9-]+\.cloudflareaccess\.com', configuration['ACCESS_TEAM_DOMAIN']):
    raise SystemExit('Invalid Access team domain')
bundle = 'app.getfolding.Folding' + ('.Staging' if environment == 'staging' else '')
variables = dict(configuration, DEPLOYMENT=environment,
    AUTH_ENCRYPTION_KEY_VERSION='v1', AUTH_SUBJECT_HMAC_KEY_VERSION='v1',
    APPLE_SIGN_IN_CLIENT_ID=bundle,
    APP_ATTEST_APP_ID=configuration['APPLE_SIGN_IN_TEAM_ID'] + '.' + bundle,
    VERIFIED_CAPABILITIES='[]', API_ORIGIN=bindings['api_origin'],
    ADMIN_ORIGIN=bindings['admin_origin'], ACCESS_AUDIENCE=bindings['access_audience'])
root = pathlib.Path(__file__).resolve().parent.parent
# Absolute paths make the generated file safe to keep outside the checkout.
result = {
    'name': bindings['worker_name'], 'account_id': bindings['account_id'],
    'main': str(root / 'backend/crates/worker/build/worker/shim.mjs'),
    'compatibility_date': '2026-11-07', 'workers_dev': False, 'preview_urls': False,
    'vars': variables,
    'd1_databases': [{'binding': 'DB', 'database_id': bindings['database_id'],
        'database_name': bindings['database_name'], 'migrations_dir': str(root / 'backend/migrations')}],
    'r2_buckets': [{'binding': 'AVATARS', 'bucket_name': bindings['avatar_bucket']}],
    'queues': {'producers': [{'binding': 'JOBS', 'queue': bindings['jobs_queue']},
        {'binding': 'JOBS_DEAD', 'queue': bindings['dead_queue']}]},
    'triggers': {'crons': ['*/5 * * * *']},
}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(result, indent=2) + '\n')
print(f'Generated {environment} Worker bindings; capabilities remain unverified.', file=sys.stderr)
