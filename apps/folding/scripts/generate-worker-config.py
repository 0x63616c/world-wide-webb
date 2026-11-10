#!/usr/bin/env python3
"""Generate Wrangler bindings from `tofu output -json application_bindings` on stdin.

Apple and Access configuration is supplied in a public JSON file. Secrets are installed
separately with Wrangler secret bindings; never pass credentials in this document.
"""
import argparse
import hashlib
import json
import pathlib
import re
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--configuration', type=pathlib.Path, required=True)
parser.add_argument('--output', type=pathlib.Path, required=True)
parser.add_argument('--readiness', type=pathlib.Path, help='Reviewed, version-bound public acceptance overlay')
parser.add_argument('--testflight-preview', action='store_true',
    help='Enable avatar uploads and APNs for an owner TestFlight build without advertising release readiness')
args = parser.parse_args()
if args.testflight_preview and args.readiness:
    raise SystemExit('TestFlight preview and reviewed release readiness are separate deployment modes')
bindings = json.load(sys.stdin)
configuration = json.loads(args.configuration.read_text())
environment = bindings['environment']
if environment != 'production':
    raise SystemExit('Invalid environment')
allowed = {
    'APPLE_SIGN_IN_TEAM_ID', 'APPLE_SIGN_IN_KEY_ID', 'APP_ATTEST_ENVIRONMENT',
    'APP_ATTEST_BUNDLE_VERSIONS', 'ACCESS_TEAM_DOMAIN', 'WORKER_VERSION',
    'ADMIN_EMAIL_ALLOWLIST', 'APNS_KEY_ID',
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
administrators = json.loads(configuration['ADMIN_EMAIL_ALLOWLIST'])
if (not isinstance(administrators, list) or not 1 <= len(administrators) <= 32
        or not all(isinstance(v, str) and re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', v)
                   for v in administrators)):
    raise SystemExit('Explicit administrator email allowlist required')
for field in ('APPLE_SIGN_IN_TEAM_ID', 'APPLE_SIGN_IN_KEY_ID', 'APNS_KEY_ID'):
    if not re.fullmatch(r'[A-Z0-9]{10}', configuration[field]):
        raise SystemExit('Invalid Apple identifier: ' + field)
if not re.fullmatch(r'https://[a-zA-Z0-9-]+\.cloudflareaccess\.com', configuration['ACCESS_TEAM_DOMAIN']):
    raise SystemExit('Invalid Access team domain')
bundle = 'app.getfolding.Folding'
variables = dict(configuration, DEPLOYMENT=environment,
    AUTH_ENCRYPTION_KEY_VERSION='v1', AUTH_SUBJECT_HMAC_KEY_VERSION='v1',
    APPLE_SIGN_IN_CLIENT_ID=bundle,
    APNS_TOPIC=bundle, APNS_ENVIRONMENT='production',
    APNS_TEAM_ID=configuration['APPLE_SIGN_IN_TEAM_ID'],
    APNS_ENABLED='false', AVATAR_UPLOADS_ENABLED='false', ADMIN_EMAIL_ENABLED='false',
    APP_ATTEST_APP_ID=configuration['APPLE_SIGN_IN_TEAM_ID'] + '.' + bundle,
    VERIFIED_CAPABILITIES='[]', API_ORIGIN=bindings['api_origin'],
    ADMIN_ORIGIN=bindings['admin_origin'], ACCESS_AUDIENCE=bindings['access_audience'])
# Bootstrap is fail-closed. A checked-in public overlay is the sole promotion input;
# regenerating the config must not silently lose an accepted feature gate.
if args.readiness:
    readiness = json.loads(args.readiness.read_text())
    expected = {'environment', 'worker_version', 'bindings_sha256', 'reviewer',
                'reviewed_at', 'evidence', 'capabilities', 'features'}
    if set(readiness) != expected:
        raise SystemExit('Readiness overlay fields differ from the contract')
    binding_hash = hashlib.sha256(json.dumps(bindings, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    if (readiness['environment'] != environment
            or readiness['worker_version'] != configuration['WORKER_VERSION']
            or readiness['bindings_sha256'] != binding_hash):
        raise SystemExit('Readiness identity differs from this deployment')
    if not all(isinstance(readiness[field], str) and readiness[field].strip()
               for field in ('reviewer', 'reviewed_at')):
        raise SystemExit('Readiness needs an identified reviewer and review time')
    import datetime
    datetime.datetime.fromisoformat(readiness['reviewed_at'].replace('Z', '+00:00'))
    implemented_source = (pathlib.Path(__file__).resolve().parent.parent /
                          'backend/crates/worker/src/capabilities_runtime.rs').read_text()
    implemented = set(re.findall(r'"([a-z_]+\.[a-z_]+)"',
                                implemented_source.split('pub(crate) fn get')[0]))
    capabilities = readiness['capabilities']
    if (not isinstance(capabilities, list) or not all(isinstance(c, str) for c in capabilities)
            or len(set(capabilities)) != len(capabilities) or not set(capabilities) <= implemented):
        raise SystemExit('Unknown or duplicate verified capability')
    features = readiness['features']
    feature_keys = {'APNS_ENABLED', 'AVATAR_UPLOADS_ENABLED', 'ADMIN_EMAIL_ENABLED'}
    if set(features) != feature_keys or any(type(v) is not bool for v in features.values()):
        raise SystemExit('Readiness requires explicit boolean feature flags')
    if ('notifications.results' in capabilities and not features['APNS_ENABLED']
            or 'avatars.upload' in capabilities and not features['AVATAR_UPLOADS_ENABLED']):
        raise SystemExit('Verified capabilities conflict with their feature gates')
    evidence = readiness['evidence']
    claims = set(capabilities) | {key for key, enabled in features.items() if enabled}
    if not isinstance(evidence, dict) or set(evidence) != claims:
        raise SystemExit('Each promoted claim requires its own acceptance evidence')
    for claim, item in evidence.items():
        if (not isinstance(item, dict) or set(item) != {'path', 'sha256'}
                or not isinstance(item['path'], str)
                or not re.fullmatch(r'[0-9a-f]{64}', item['sha256'])):
            raise SystemExit('Invalid evidence record: ' + claim)
        evidence_path = (args.readiness.parent / item['path']).resolve()
        if not evidence_path.is_relative_to(args.readiness.parent.resolve()):
            raise SystemExit('Evidence must be stored beside the overlay')
        if hashlib.sha256(evidence_path.read_bytes()).hexdigest() != item['sha256']:
            raise SystemExit('Acceptance evidence hash differs: ' + claim)
    variables.update({key: str(enabled).lower() for key, enabled in features.items()})
    variables['VERIFIED_CAPABILITIES'] = json.dumps(sorted(capabilities), separators=(',', ':'))
if args.testflight_preview:
    variables['APNS_ENABLED'] = 'true'
    variables['AVATAR_UPLOADS_ENABLED'] = 'true'
root = pathlib.Path(__file__).resolve().parent.parent
# Absolute paths make the generated file safe to keep outside the checkout.
result = {
    'name': bindings['worker_name'], 'account_id': bindings['account_id'],
    'main': str(root / 'backend/crates/worker/build/worker/shim.mjs'),
    'compatibility_date': '2026-11-07', 'workers_dev': False, 'preview_urls': False,
    'vars': variables,
    'limits': {'cpu_ms': 5000},
    # Structured application events only: avoid persisting URLs/auth headers from invocation logs.
    'observability': {'enabled': True, 'head_sampling_rate': 0.1,
        'logs': {'enabled': True, 'invocation_logs': False}},
    # Separate environment namespaces; approximate per-location burst protection.
    # Existing D1 account limits remain authoritative across locations/sessions.
    'ratelimits': [
        {'name': name, 'namespace_id': str((5500 if environment == 'production' else 5400) + index),
         'simple': {'limit': limit, 'period': 60}}
        for index, (name, limit) in enumerate([
            ('API_NETWORK_BURST', 600), ('AUTH_NETWORK_BURST', 60),
            ('API_CREDENTIAL_BURST', 120),
        ])
    ],
    'd1_databases': [{'binding': 'DB', 'database_id': bindings['database_id'],
        'database_name': bindings['database_name'], 'migrations_dir': str(root / 'backend/migrations')}],
    'r2_buckets': [{'binding': 'AVATARS', 'bucket_name': bindings['avatar_bucket']}],
    'queues': {'producers': [{'binding': 'JOBS', 'queue': bindings['jobs_queue']},
        {'binding': 'JOBS_DEAD', 'queue': bindings['dead_queue']}],
        'consumers': [{'queue': bindings['jobs_queue'], 'max_batch_size': 10,
            'max_batch_timeout': 5, 'max_retries': 12, 'retry_delay': 30,
            'max_concurrency': 2, 'dead_letter_queue': bindings['dead_queue']}]},
    'triggers': {'crons': ['*/5 * * * *']},
}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(result, indent=2) + '\n')
print(f'Generated {environment} Worker bindings; readiness overlay: {bool(args.readiness)}; '
      f'TestFlight preview: {args.testflight_preview}.', file=sys.stderr)
