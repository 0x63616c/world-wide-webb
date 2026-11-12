#!/usr/bin/env python3
"""Validate hand-authored v1 contract schemas, examples and rejection cases."""

from pathlib import Path
import copy
import json

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = ROOT / "contracts" / "schemas"
FIXTURES = ROOT / "contracts" / "fixtures"
schemas = {p.name: json.loads(p.read_text()) for p in SCHEMAS.glob("*.json")}
registry = Registry().with_resources((s["$id"], Resource.from_contents(s)) for s in schemas.values())
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
    assert not validators[schema].is_valid(value), f"{schema} accepted invalid example"
    checks += 1


policy = {"minimum_ios_build": 10, "request_id": "00000000-0000-0000-0000-000000000001"}
valid("client-policy.schema.json", policy)
valid("error.schema.json", dict(policy, code="app_update_required", retryable=True, retry_after_seconds=3600))
for floor in [-1, 2147483648, "10", None]:
    invalid("client-policy.schema.json", dict(policy, minimum_ios_build=floor))

for stem in (
    "history-batch",
    "event-batch",
    "event-receipt",
    "reset-request",
    "error",
    "entry-deletion-request",
    "entry-deletion-receipt",
):
    valid(f"{stem}.schema.json", json.loads((FIXTURES / f"{stem}.json").read_text()))
auth = json.loads((FIXTURES / "auth-requests.json").read_text())
for case in auth["valid"]:
    valid(f"{case['schema']}.schema.json", case["body"])
for case in auth["invalid"]:
    invalid(f"{case['schema']}.schema.json", case["body"])

reducer = json.loads((FIXTURES / "reducer.json").read_text())
for case in reducer["cases"]:
    for event in case["events_in_arrival_order"]:
        valid("event.schema.json", event)
    for interruption in case.get("interruptions", []):
        valid("interruption.schema.json", interruption)

example = reducer["cases"][0]["events_in_arrival_order"][0]
for key, bad in [
    ("sequence", 0),
    ("sequence", 9007199254740992),
    ("transition", "flat"),
    ("observed_at_ms", -1),
    ("is_test", "false"),
    ("event_id", "not-a-uuid"),
]:
    changed = copy.deepcopy(example)
    changed[key] = bad
    invalid("event.schema.json", changed)
changed = copy.deepcopy(example)
changed["client_total"] = 999
invalid("event.schema.json", changed)
changed = copy.deepcopy(example)
del changed["generation"]
invalid("event.schema.json", changed)
batch = json.loads((FIXTURES / "event-batch.json").read_text())
batch["events"] = []
invalid("event-batch.schema.json", batch)
receipt = json.loads((FIXTURES / "event-receipt.json").read_text())
receipt["events"][0]["disposition"] = "quarantined"
invalid("event-receipt.schema.json", receipt)

deletion = json.loads((FIXTURES / "entry-deletion-request.json").read_text())
for key, value in [
    ("event_ids", []),
    ("event_ids", deletion["event_ids"] * 2),
    ("epoch_ids", []),
    ("epoch_ids", deletion["epoch_ids"] * 2),
    ("client_total", 100),
]:
    changed = copy.deepcopy(deletion)
    changed[key] = value
    invalid("entry-deletion-request.schema.json", changed)

# Parse the complete fixture set; these lifecycle expectations are consumed by
# later Swift/Rust integration tests, not claimed as executed implementation here.
for path in FIXTURES.glob("*.json"):
    json.loads(path.read_text())
print(f"PASS: {len(schemas)} schemas and {checks} schema/example checks; all fixtures parse.")

legacy_preferences = {"weekly": "off", "monthly": "off", "home_timezone": "UTC", "locale": "en"}
valid("notification-preferences.schema.json", legacy_preferences)
valid("notification-preferences.schema.json", dict(legacy_preferences, badge_earned=True))
invalid("notification-preferences.schema.json", dict(legacy_preferences, badge_earned=1))
