#!/usr/bin/env python3
"""Transfer one pinned flat Linux Tart image without transferring registry credentials.

Run install as the Tart service user, never root. For SSH delivery the administrator
can open the bundle and redirect it to this command's stdin after dropping identity.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import tarfile
import tempfile

FILES = ('config.json', 'disk.img', 'nvram.bin', 'manifest.json')
LIMIT = 32 * 1024 ** 3
PREFIX = 'application/vnd.cirruslabs.tart.'


def image_path(home, image):
    if not re.fullmatch(r'ghcr\.io/[a-z0-9_.-]+/[a-z0-9_.-]+@sha256:[a-f0-9]{64}', image):
        raise ValueError('supply one immutable GHCR owner/package image digest')
    namespace, digest = image.split('@')
    if any(part in ('.', '..') for part in namespace.split('/')):
        raise ValueError('image namespace contains traversal')
    return pathlib.Path(home) / 'cache/OCIs' / namespace / digest


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(data)
    return digest.hexdigest()


def validate(directory, image):
    digest = image.split('@')[1]
    sizes = {}
    for name in FILES:
        metadata = (directory / name).lstat()
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or metadata.st_size > LIMIT:
            raise ValueError('cache must contain bounded standalone regular files')
        sizes[name] = metadata.st_size
    if sizes['manifest.json'] > 1024 * 1024 or sizes['config.json'] > 64 * 1024 or sizes['nvram.bin'] > 1024 * 1024:
        raise ValueError('cache metadata exceeds its bound')
    if 'sha256:' + sha(directory / 'manifest.json') != digest:
        raise ValueError('manifest does not match the pinned registry digest')
    manifest = json.loads((directory / 'manifest.json').read_text())
    layers = manifest['layers']
    allowed = {PREFIX + name for name in ('config.v1', 'disk.v2', 'nvram.v1')}
    if any(layer['mediaType'] not in allowed for layer in layers):
        raise ValueError('only flat Linux images are supported, not external disk stacks')
    config = json.loads((directory / 'config.json').read_text())
    if config.get('os') != 'linux' or config.get('arch') != 'arm64' or config.get('diskFormat', 'raw') != 'raw':
        raise ValueError('this cache transfer is restricted to Linux images')
    for name, media in [('config.json', 'config.v1'), ('nvram.bin', 'nvram.v1')]:
        descriptors = [layer for layer in layers if layer['mediaType'] == PREFIX + media]
        if len(descriptors) != 1 or descriptors[0]['size'] != sizes[name] or descriptors[0]['digest'] != 'sha256:' + sha(directory / name):
            raise ValueError('cached metadata differs from the authenticated manifest')
    chunks = [layer for layer in layers if layer['mediaType'] == PREFIX + 'disk.v2']
    if not chunks:
        raise ValueError('manifest has no disk chunks')
    full = hashlib.sha256()
    with (directory / 'disk.img').open('rb') as disk:
        for chunk in chunks:
            annotations = chunk.get('annotations', {})
            remaining = int(annotations['org.cirruslabs.tart.uncompressed-size'])
            if not 0 < remaining <= LIMIT:
                raise ValueError('disk chunk size is invalid')
            content = hashlib.sha256()
            while remaining:
                data = disk.read(min(1024 * 1024, remaining))
                if not data:
                    raise ValueError('cached disk is truncated')
                content.update(data)
                full.update(data)
                remaining -= len(data)
            expected = annotations['org.cirruslabs.tart.uncompressed-content-digest']
            if 'sha256:' + content.hexdigest() != expected:
                raise ValueError('cached disk differs from a manifest chunk')
        if disk.read(1):
            raise ValueError('cached disk has unreferenced trailing content')
    return {'schema': 1, 'image': image, 'disk_sha256': full.hexdigest(), 'sizes': sizes}


def pack(home, image, output):
    directory = image_path(home, image)
    receipt = validate(directory, image)
    output = pathlib.Path(output).resolve()
    if output.exists():
        raise ValueError('refuse to overwrite an existing image bundle')
    with tempfile.TemporaryDirectory(prefix='homelab-image-receipt-') as temp:
        pathlib.Path(temp, 'receipt.json').write_text(json.dumps(receipt))
        subprocess.run(['tar', '--format=pax', '-S', '--no-xattrs', '-czf', str(output),
                        '-C', temp, 'receipt.json', '-C', str(directory), *FILES],
                       env=dict(os.environ, COPYFILE_DISABLE='1'), check=True)
    return receipt


def install(home, image, bundle):
    if os.geteuid() == 0:
        raise ValueError('install must run as the unprivileged Tart service account')
    home = pathlib.Path(home).resolve(strict=True)
    if home.stat().st_uid != os.geteuid():
        raise ValueError('Tart home must belong to the installing service account')
    target = image_path(home, image)
    if target.exists() or target.is_symlink():
        raise ValueError('cache already exists; verify it rather than replacing it')
    with tempfile.TemporaryDirectory(prefix='.image-stage-', dir=home) as temp:
        stage = pathlib.Path(temp)
        archive_path = pathlib.Path(bundle) if bundle != '-' else stage / 'input.tar.gz'
        if bundle == '-':
            with archive_path.open('xb') as output:
                total = 0
                for data in iter(lambda: sys.stdin.buffer.read(1024 * 1024), b''):
                    total += len(data)
                    if total > 8 * 1024 ** 3:
                        raise ValueError('compressed image exceeds 8 GiB transfer limit')
                    output.write(data)
        extracted = stage / 'image'
        extracted.mkdir(mode=0o700)
        with tarfile.open(archive_path, 'r:gz') as archive:
            members = archive.getmembers()
            names = [member.name for member in members]
            if set(names) != {*FILES, 'receipt.json'} or len(names) != len(set(names)):
                raise ValueError('bundle has missing, duplicate or unexpected paths')
            bounds = {'disk.img': LIMIT, 'config.json': 64 * 1024, 'receipt.json': 64 * 1024,
                      'manifest.json': 1024 * 1024, 'nvram.bin': 1024 * 1024}
            if any(not member.isfile() or not 0 <= member.size <= bounds[member.name] for member in members):
                raise ValueError('bundle contains links, special files or oversized files')
            if archive.getmember('receipt.json').size > 64 * 1024:
                raise ValueError('bundle receipt exceeds its bound')
            # Every member is one of five exact regular filenames. Sparse disk
            # metadata is preserved; arbitrary paths and links cannot be extracted.
            archive.extractall(extracted, members=members)
        receipt = json.loads((extracted / 'receipt.json').read_text())
        verified = validate(extracted, image)
        if receipt != verified:
            raise ValueError('bundle receipt differs from verified image contents')
        (extracted / 'receipt.json').unlink()
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.rename(extracted, target)
    return verified


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['pack', 'install', 'verify'])
    parser.add_argument('--tart-home', required=True)
    parser.add_argument('--image', required=True)
    parser.add_argument('--bundle')
    args = parser.parse_args()
    if args.operation in ('pack', 'install') and not args.bundle:
        parser.error('--bundle is required')
    if args.operation == 'pack':
        result = pack(args.tart_home, args.image, args.bundle)
    elif args.operation == 'install':
        result = install(args.tart_home, args.image, args.bundle)
    else:
        result = validate(image_path(args.tart_home, args.image), args.image)
    print(json.dumps(result, indent=2))
