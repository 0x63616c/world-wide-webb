#!/usr/bin/env python3
"""Exercise the private operations transport without touching a live service."""

import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import socket
import subprocess

TARGET = 'homelab-mac-mini.tail8c014d.ts.net'
OTHER_PEER = 'homelab-macbook.tail8c014d.ts.net'
REMOTE = '''import hashlib,json,pathlib,sys,tempfile
data=sys.stdin.buffer.read(513)
assert len(data)<=512
value=json.loads(data)
assert set(value)=={"source","schema"} and value["schema"]==1
with tempfile.TemporaryDirectory(prefix="homelab-operations-canary-") as directory:
    root=pathlib.Path(directory)
    target=root/"checked-source.json"
    target.write_bytes(data)
    assert target.read_bytes()==data
assert not root.exists()
print(json.dumps({"source":value["source"],"sha256":hashlib.sha256(data).hexdigest(),"staged":True,"cleaned":True}))
'''


def main():
    source = os.environ['SOURCE_SHA']
    if not re.fullmatch(r'[a-f0-9]{40}', source):
        raise ValueError('Canary needs its checked source')
    root = Path(os.environ['RUNNER_TEMP'])
    key, hosts = root / 'homelab-operations-key', root / 'homelab-operations-known-hosts'
    for path in (key, hosts):
        info = path.lstat()
        if path.is_symlink() or not path.is_file() or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise ValueError('Operations identity and peer pins must be private regular files')
    # Resolve independently: missing DNS is not evidence of an access-policy denial.
    peers = socket.getaddrinfo(OTHER_PEER, 22, type=socket.SOCK_STREAM)
    if not peers:
        raise ValueError('The negative-control peer must resolve')
    for family, kind, protocol, _name, address in peers:
        with socket.socket(family, kind, protocol) as connection:
            connection.settimeout(5)
            if connection.connect_ex(address) == 0:
                raise ValueError('Operations identity can reach an unapproved peer SSH endpoint')
    payload = json.dumps({'schema': 1, 'source': source}, sort_keys=True).encode()
    remote = subprocess.run([
        'ssh', '-i', str(key), '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
        '-o', 'StrictHostKeyChecking=yes', '-o', f'UserKnownHostsFile={hosts}',
        '-o', 'ConnectTimeout=10', '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes',
        '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'IdentityAgent=none',
        'admin@' + TARGET, '/usr/bin/python3 -c ' + shlex.quote(REMOTE),
    ], input=payload, capture_output=True, timeout=30, check=True)
    result = json.loads(remote.stdout)
    if result != {'source': source, 'sha256': hashlib.sha256(payload).hexdigest(), 'staged': True, 'cleaned': True}:
        raise ValueError('Operations staging/cleanup did not return matching evidence')
    print(json.dumps(dict(result, other_peer_ssh_unreachable=True)))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        raise SystemExit('Operations transport was not verified; keep production delivery disabled') from None
