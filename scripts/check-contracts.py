#!/usr/bin/env python3
"""Validate hand-authored v1 contract schemas, examples and rejection cases."""
from pathlib import Path
import copy
import json

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = ROOT / 'contracts' / 'schemas'
FIXTURES = ROOT / 'contracts' / 'fixtures'
schemas = {p.name: json.loads(p.read_text()) for p in SCHEMAS.glob('*.json')}
registry = Registry().with_resources(
    (s['$id'], Resource.from_contents(s)) for s in schemas.values()
)
validators = {}
for name, schema in schemas.items():
    Draft202012Validator.check_schema(schema)
    validators[name] = Draft202012Validator(schema, registry=registry)

checks = 0

def valid(schema, value):
    global checks
    validators[schema].validate(value)
    checks += 1


def invalid(schema, value):
    global checks
    assert not validators[schema].is_valid(value), f'{schema} accepted invalid example'
    checks += 1

for stem in ('event-batch', 'event-receipt', 'reset-request', 'error'):
    valid(f'{stem}.schema.json', json.loads((FIXTURES / f'{stem}.json').read_text()))
reducer = json.loads((FIXTURES / 'reducer.json').read_text())
for case in reducer['cases']:
    for event in case['events_in_arrival_order']:
        valid('event.schema.json', event)
    for interruption in case.get('interruptions', []):
        valid('interruption.schema.json', interruption)

example = reducer['cases'][0]['events_in_arrival_order'][0]
for key, bad in [('sequence', 0), ('sequence', 9007199254740992),
                 ('transition', 'flat'), ('observed_at_ms', -1),
                 ('is_test', 'false'), ('event_id', 'not-a-uuid')]:
    changed = copy.deepcopy(example)
    changed[key] = bad
    invalid('event.schema.json', changed)
changed = copy.deepcopy(example)
changed['client_total'] = 999
invalid('event.schema.json', changed)
changed = copy.deepcopy(example)
del changed['generation']
invalid('event.schema.json', changed)
batch = json.loads((FIXTURES / 'event-batch.json').read_text())
batch['events'] = []
invalid('event-batch.schema.json', batch)
receipt = json.loads((FIXTURES / 'event-receipt.json').read_text())
receipt['events'][0]['disposition'] = 'quarantined'
invalid('event-receipt.schema.json', receipt)

# Parse the complete fixture set; these lifecycle expectations are consumed by
# later Swift/Rust integration tests, not claimed as executed implementation here.
for path in FIXTURES.glob('*.json'):
    json.loads(path.read_text())
print(f'PASS: {len(schemas)} schemas and {checks} schema/example checks; all fixtures parse.')
