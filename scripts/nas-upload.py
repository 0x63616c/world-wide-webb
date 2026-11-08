#!/usr/bin/env python3
"""Append backup files to Synology and verify each by downloading its SHA-256.

File Station protocol: https://global.download.synology.com/download/Document/
Software/DeveloperGuide/Package/FileStation/All/enu/Synology_File_Station_API_Guide.pdf
Credentials are consumed from a private JSON file, never logged. TLS is pinned
before sending credentials; certificate rotation requires deliberate reprovisioning.
No remote overwrite, deletion, retention purge, or notification is performed.
"""
import argparse
import hashlib
import http.client
import json
import re
import secrets
import ssl
import sys
import urllib.parse
from pathlib import Path


class NasApiError(RuntimeError):
    def __init__(self, operation, code):
        self.code = code
        super().__init__(f'NAS {operation} error {code}')


class Nas:
    def __init__(self, config):
        self.config = config
        self.sid = None

    def connect(self):
        # Pin the entire server certificate instead of relying on the NAS's
        # self-signed issuer or disabling verification without a replacement.
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        connection = http.client.HTTPSConnection(
            self.config['host'], self.config.get('port', 5001),
            context=context, timeout=300,
        )
        connection.connect()
        actual = hashlib.sha256(connection.sock.getpeercert(binary_form=True)).hexdigest()
        if actual != self.config['certificate_sha256']:
            connection.close()
            raise RuntimeError('NAS certificate pin mismatch')
        return connection

    def call(self, api, method, version=2, **params):
        params.update(api=api, method=method, version=version)
        if self.sid:
            params['_sid'] = self.sid
        body = urllib.parse.urlencode(params).encode()
        c = self.connect()
        try:
            c.request('POST', '/webapi/entry.cgi', body,
                      {'Content-Type': 'application/x-www-form-urlencoded'})
            response = c.getresponse()
            if response.status != 200:
                raise RuntimeError(f'NAS HTTP status {response.status}')
            result = json.load(response)
            if not result.get('success'):
                raise NasApiError(f'{api}.{method}', result.get('error', {}).get('code'))
            return result.get('data', {})
        finally:
            c.close()

    def login(self):
        self.sid = None
        self.sid = self.call('SYNO.API.Auth', 'login', 6,
                             account=self.config['username'], passwd=self.config['password'],
                             session='FileStation', format='sid')['sid']

    def logout(self):
        if self.sid:
            self.call('SYNO.API.Auth', 'logout', 6, session='FileStation')
            self.sid = None

    def upload(self, path, destination):
        for attempt in range(2):
            try:
                return self._upload(path, destination)
            except NasApiError as error:
                # 119 rejects authentication before accepting file data. Refresh
                # once; do not retry ambiguous transport failures or overwrite
                # an existing destination after a partially completed request.
                if error.code != 119 or attempt:
                    raise
                self.login()

    def _upload(self, path, destination):
        if not re.fullmatch(r'[A-Za-z0-9_.-]+', path.name):
            raise ValueError('Backup filename must contain only letters, numbers, dots, dashes or underscores')
        boundary = secrets.token_hex(24)
        fields = dict(api='SYNO.FileStation.Upload', version='2', method='upload',
                      path=destination, create_parents='true')
        # Omitting overwrite makes an existing destination an error, not success
        # with an old file or replacement of a prior backup.
        prefix = ''.join(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'
            for key, value in fields.items()
        ).encode()
        prefix += (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; '
                   f'filename="{path.name}"\r\nContent-Type: application/octet-stream\r\n\r\n').encode()
        suffix = f'\r\n--{boundary}--\r\n'.encode()
        checksum = hashlib.sha256()
        c = self.connect()
        try:
            with path.open('rb') as source:
                size = path.stat().st_size
                # DSM authenticates uploads before parsing multipart fields.
                c.putrequest('POST', '/webapi/entry.cgi?' + urllib.parse.urlencode({'_sid': self.sid}))
                c.putheader('Content-Type', f'multipart/form-data; boundary={boundary}')
                c.putheader('Content-Length', str(len(prefix) + size + len(suffix)))
                c.endheaders()
                c.send(prefix)
                sent = 0
                while chunk := source.read(1024 * 1024):
                    c.send(chunk)
                    checksum.update(chunk)
                    sent += len(chunk)
                if sent != size:
                    raise RuntimeError('Backup file changed size during upload')
                c.send(suffix)
            response = c.getresponse()
            if response.status != 200:
                raise RuntimeError(f'NAS upload HTTP status {response.status}')
            result = json.load(response)
            if not result.get('success'):
                raise NasApiError('upload', result.get('error', {}).get('code'))
        finally:
            c.close()
        remote_path = destination + '/' + path.name
        actual, downloaded = self.download_hash(remote_path)
        if actual != checksum.hexdigest() or downloaded != size:
            raise RuntimeError('NAS read-back checksum or size mismatch; backup is unverified')
        return dict(file=path.name, bytes=size, sha256=actual, remote_path=remote_path)

    def download_hash(self, path):
        params = dict(api='SYNO.FileStation.Download', method='download', version=2,
                      path=json.dumps([path]), mode='open', _sid=self.sid)
        c = self.connect()
        try:
            c.request('POST', '/webapi/entry.cgi', urllib.parse.urlencode(params),
                      {'Content-Type': 'application/x-www-form-urlencoded'})
            response = c.getresponse()
            if response.status != 200:
                raise RuntimeError(f'NAS download HTTP status {response.status}')
            checksum, size = hashlib.sha256(), 0
            while chunk := response.read(1024 * 1024):
                checksum.update(chunk)
                size += len(chunk)
            return checksum.hexdigest(), size
        finally:
            c.close()


def valid_destination(destination):
    return re.fullmatch(
        r'/Homelab/backups/(?:mac-mini|homelab-mac-mini|homelab-macbook)/[A-Za-z0-9_-]+'
        r'|/Homelab/backups/(?:homelab-mac-mini|homelab-macbook)/(?:control-center-history|penpot)/\d{8}T\d{6}Z-[a-f0-9]{8}',
        destination) is not None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--destination', required=True)
    parser.add_argument('files', type=Path, nargs='+')
    args = parser.parse_args()
    if not valid_destination(args.destination):
        parser.error('Use a unique backup directory beneath an approved homelab host namespace')
    if args.config.stat().st_mode & 0o077:
        parser.error('Credential file must not be accessible to group or others')
    nas = Nas(json.loads(args.config.read_text()))
    try:
        nas.login()
        for path in args.files:
            print(json.dumps(nas.upload(path, args.destination)), flush=True)
    finally:
        nas.logout()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Exception strings from network libraries may contain credential-bearing
        # request details. Emit only our bounded validation errors or error type.
        print(str(error) if isinstance(error, (RuntimeError, ValueError)) else type(error).__name__, file=sys.stderr)
        sys.exit(1)
