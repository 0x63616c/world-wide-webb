#!/usr/bin/env python3
"""Report or retire only the three permanently allowlisted apps. No certificate API."""
import argparse
import base64
import json
import os
import re
import time
from urllib.error import HTTPError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen

ROOTS = ('com.calumwebb.blockr', 'com.calumwebb.festr', 'com.calum.shots')
API = 'https://api.appstoreconnect.apple.com'


def allowed(identifier):
    return isinstance(identifier, str) and any(
        identifier == root or (identifier.startswith(root + '.') and
                               re.fullmatch(r'[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*', identifier[len(root) + 1:]))
        for root in ROOTS)


def guard(identifier):
    # This includes Tendr's current com.calumwebb.still and any future ID:
    # com.calumwebb.tendr and ALL other non-allowlisted IDs are refused.
    if not allowed(identifier):
        raise ValueError('Refused non-retired bundle identifier')
    return identifier


def private_key(content):
    content = content.strip()
    if content.startswith('-----BEGIN'):
        return content
    return base64.b64decode(''.join(content.split()), validate=True).decode()


def safe(value):
    value = str(value)
    for key in ('ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_CONTENT'):
        secret = os.environ.get(key)
        if secret:
            value = value.replace(secret, '[redacted]')
    value = re.sub(r'[^\s<>|]+@[^\s<>|]+', '[email redacted]', value)
    return value.replace('|', '\\|').replace('\n', ' ').replace('\r', ' ').replace('<', '&lt;').replace('>', '&gt;')


class APIError(Exception):
    pass


class Client:
    def request(self, method, path, body=None):
        import jwt  # Only live API calls require PyJWT[crypto].
        url = path if path.startswith('https://') else API + path
        parsed = urlparse(url)
        if parsed.scheme != 'https' or parsed.netloc != urlparse(API).netloc or not parsed.path.startswith('/v1/'):
            raise ValueError('Refused unexpected API URL')
        key = private_key(os.environ['ASC_KEY_CONTENT'])
        now = int(time.time())
        token = jwt.encode({'iss': os.environ['ASC_ISSUER_ID'], 'iat': now, 'exp': now + 600,
                            'aud': 'appstoreconnect-v1'}, key, algorithm='ES256',
                           headers={'kid': os.environ['ASC_KEY_ID'], 'typ': 'JWT'})
        request = Request(url, data=json.dumps(body).encode() if body else None, method=method,
                          headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        try:
            with urlopen(request, timeout=60) as response:
                data = response.read()
                return json.loads(data) if data else {}
        except HTTPError as error:
            try:
                errors = json.loads(error.read()).get('errors', [])
                detail = '; '.join(f"{item.get('code', '')}: {item.get('title', '')}: {item.get('detail', '')}" for item in errors)
            except (ValueError, TypeError):
                detail = 'API error details unavailable'
            raise APIError(f'HTTP {error.code}: {safe(detail)}') from None

    def list(self, path, **params):
        path += '?' + urlencode({'limit': 200, **params})
        records = []
        while path:
            response = self.request('GET', path)
            records.extend(response['data'])
            path = response.get('links', {}).get('next')
        return records


def rid(record):
    return quote(record['id'], safe='')


class Retirement:
    def __init__(self, client):
        self.client = client
        self.failed = False
        self.lines = []

    def emit(self, line):
        self.lines.append(line)
        print(line, flush=True)

    def table(self, title, columns, rows):
        self.emit('\n### ' + title)
        self.emit('| ' + ' | '.join(columns) + ' |')
        self.emit('| ' + ' | '.join(['---'] * len(columns)) + ' |')
        for row in rows:
            self.emit('| ' + ' | '.join(safe(cell) for cell in row) + ' |')
        if not rows:
            self.emit('| ' + ' | '.join(['None'] + ['—'] * (len(columns) - 1)) + ' |')

    def error(self, context, error):
        self.failed = True
        # Unexpected exceptions may contain credentials; never stringify them.
        detail = str(error) if isinstance(error, APIError) else type(error).__name__
        self.emit(f'Error: {safe(context)}: {safe(detail)}')

    def report(self):
        apps, bundles = {}, {}
        for root in ROOTS:
            guard(root)
            try:
                records = self.client.list('/v1/apps', **{'filter[bundleId]': root})
                if not records:
                    self.emit(f'No ASC app record for {root}.')
                for app in records:
                    guard(app['attributes']['bundleId'])
                    apps[app['id']] = app
                for bundle in self.client.list('/v1/bundleIds', **{'filter[identifier]': root}):
                    if allowed(bundle['attributes']['identifier']):
                        bundles[bundle['id']] = bundle
            except Exception as error:
                self.error(root, error)
        # Apple's identifier filter may be exact-only: enumerate all pages as well,
        # then select dot-suffixed children client-side. Never report unrelated IDs.
        try:
            for bundle in self.client.list('/v1/bundleIds'):
                if allowed(bundle['attributes']['identifier']):
                    bundles[bundle['id']] = bundle
        except Exception as error:
            self.error('bundle discovery', error)
        builds, profiles = [], []
        for app in apps.values():
            identifier = guard(app['attributes']['bundleId'])
            try:
                versions = self.client.list(f'/v1/apps/{rid(app)}/appStoreVersions')
                items = self.client.list('/v1/builds', **{'filter[app]': app['id']})
                unexpired = [item for item in items if item['attributes']['expired'] is False]
                self.table('App', ['Name', 'Apple ID', 'Bundle ID', 'Builds', 'Unexpired'],
                           [[app['attributes']['name'], app['id'], identifier, len(items), len(unexpired)]])
                self.table('App Store versions', ['App', 'Version', 'State'],
                           [[identifier, v['attributes']['versionString'], v['attributes'].get('appVersionState', v['attributes'].get('appStoreState', '?'))] for v in versions])
                groups = self.client.list(f'/v1/apps/{rid(app)}/betaGroups')
                rows = []
                for group in groups:
                    testers = self.client.list(f'/v1/betaGroups/{rid(group)}/relationships/betaTesters')
                    rows.append([identifier, group['attributes']['name'], group['id'], len(testers)])
                self.table('Beta groups', ['App', 'Group', 'ID', 'Tester count'], rows)
                builds.extend((identifier, item) for item in unexpired)
            except Exception as error:
                self.error(identifier, error)
        if not apps:
            self.emit('No allowlisted ASC app records found.')
        self.table('Bundle IDs', ['Identifier', 'ID', 'Platform'],
                   [[guard(b['attributes']['identifier']), b['id'], b['attributes']['platform']] for b in bundles.values()])
        for bundle in bundles.values():
            identifier = guard(bundle['attributes']['identifier'])
            try:
                items = self.client.list(f'/v1/bundleIds/{rid(bundle)}/profiles', **{'fields[profiles]': 'name,profileState'})
                self.table('Provisioning profiles', ['Bundle ID', 'Name', 'ID', 'State'],
                           [[identifier, p['attributes']['name'], p['id'], p['attributes']['profileState']] for p in items])
                profiles.extend((identifier, p) for p in items)
            except Exception as error:
                self.error(identifier, error)
        return builds, profiles, list(bundles.values())

    def action(self, identifier, method, path, body=None):
        guard(identifier)
        try:
            self.client.request(method, path, body)
            self.emit(f'{method} {safe(path)} ({safe(identifier)}): OK')
        except Exception as error:
            self.error(f'{method} {path} ({identifier})', error)

    def run(self, mode):
        if mode not in ('report', 'retire', 'delete-ids'):
            raise ValueError('Unknown mode')
        self.emit('# ASC retirement: ' + mode)
        self.emit('Guard: only retired roots and their children; com.calumwebb.tendr and every other ID are excluded. Certificates are never touched.')
        builds, profiles, bundles = self.report()
        # Incomplete discovery must not produce an incomplete destructive operation.
        if self.failed:
            self.emit('Discovery failed; no mutations performed. Re-run after resolving the errors.')
        elif mode == 'retire':
            for identifier, build in builds:
                self.action(identifier, 'PATCH', f'/v1/builds/{rid(build)}',
                            {'data': {'type': 'builds', 'id': build['id'], 'attributes': {'expired': True}}})
            for identifier, profile in profiles:
                self.action(identifier, 'DELETE', f'/v1/profiles/{rid(profile)}')
        elif mode == 'delete-ids':
            for bundle in sorted(bundles, key=lambda b: b['attributes']['identifier'].count('.'), reverse=True):
                self.action(bundle['attributes']['identifier'], 'DELETE', f'/v1/bundleIds/{rid(bundle)}')
        return 1 if self.failed else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=('report', 'retire', 'delete-ids'), default='report')
    args = parser.parse_args()
    retirement = Retirement(Client())
    try:
        return retirement.run(args.mode)
    finally:
        if os.environ.get('GITHUB_STEP_SUMMARY'):
            with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
                summary.write('\n'.join(retirement.lines) + '\n')


if __name__ == '__main__':
    raise SystemExit(main())
