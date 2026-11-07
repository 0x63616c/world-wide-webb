#!/usr/bin/env python3
"""Copy encrypted remote state to a unique recovery key without exposing its contents."""
import argparse
import datetime
import hashlib
import json
import uuid

import boto3

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('environment', choices=['staging', 'production'])
args = parser.parse_args()
client = boto3.client('s3', region_name='auto',
    endpoint_url='https://eb3ea2e5ef93e58704d39980583fee38.r2.cloudflarestorage.com')
bucket = 'folding-infrastructure-state'
body = client.get_object(Bucket=bucket, Key=f'folding/{args.environment}.tfstate')['Body'].read()
state = json.loads(body)
if 'encrypted_data' not in state or 'resources' in state:
    raise SystemExit('Refusing to back up unencrypted state')
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
key = f'backups/{args.environment}/{stamp}-{uuid.uuid4()}.tfstate'
client.put_object(Bucket=bucket, Key=key, Body=body, IfNoneMatch='*')
recovered = client.get_object(Bucket=bucket, Key=key)['Body'].read()
if recovered != body:
    raise SystemExit('Backup verification failed')
print(json.dumps({'backup_key': key, 'sha256': hashlib.sha256(body).hexdigest()}))
