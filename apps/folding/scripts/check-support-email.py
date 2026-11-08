#!/usr/bin/env python3
"""Check configured forwarding without printing the private recipient."""
import json
import os
import urllib.request

zone = os.environ['TF_VAR_zone_id']
destination = os.environ['TF_VAR_support_destination']

def get(path, token=None):
    request = urllib.request.Request('https://api.cloudflare.com/client/v4/' + path,
        headers={'Authorization': 'Bearer ' + (token or os.environ['CLOUDFLARE_API_TOKEN'])})
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)
    if not result.get('success'):
        raise SystemExit('Cloudflare verification request failed')
    return result['result']

settings = get(f'zones/{zone}/email/routing')
rules = get(f'zones/{zone}/email/routing/rules')
matching = [rule for rule in rules if rule.get('enabled') and any(
    matcher.get('type') == 'literal' and matcher.get('field') == 'to'
    and matcher.get('value') == 'support@getfolding.app' for matcher in rule.get('matchers', []))]
assert settings.get('enabled'), 'Email Routing is not enabled'
assert len(matching) == 1, 'Expected exactly one enabled support rule'
assert matching[0]['actions'] == [{'type': 'forward', 'value': [destination]}], 'Unexpected destination/action'
addresses = get('accounts/' + os.environ['CLOUDFLARE_ACCOUNT_ID'] + '/email/routing/addresses', os.environ.get('CF_EMAIL_READ_TOKEN'))
assert any(address.get('email') == destination and address.get('verified') for address in addresses)
print('PASS: Email Routing enabled; support rule forwards to the verified requested recipient. Inbox delivery test remains pending.')
