# Bedroom wall-switch binding — activation disabled

**DO NOT MERGE until Calum approves after entity verification: main auto-deploys.**
No production entity ID is supplied. No live device or HA verification was done.
The existing Bedroom lamp registry supplies both bedside Hue lamps and Mirror;
the input is never added to `LIGHTS` as an actuator. The panel UI is unchanged.

## Activation gate and rollback

All three environment values must be present on the worker/www process:

- `BEDROOM_SWITCH_INPUT_ENABLED=true` (default `false`)
- `BEDROOM_SWITCH_INPUT_VERIFIED=true` (default `false`)
- `BEDROOM_SWITCH_INPUT_ENTITY_ID=<verified Input 0 binary_sensor entity_id>`

Missing, false, or malformed config creates no input connection, desired write,
or HA call. The verification flag is an operator assertion, not device discovery.
Do not set it until Calum verifies the actual Input 0 ID, Detached mode, and the
representation below. No Shelly/HA automation should own this input (Calum's
stated decision); Apple Home ownership remains unconfirmed and must be checked.
The deployment currently does not forward these keys: activation later requires
an approved Compose environment change plus process restart. There are no changes
to deployed environment values in this implementation. Roll back by setting either
flag to `false` or removing the entity ID, then restarting the process.

## Required verification before approval

With Calum's explicit authorization for live work, confirm Input 0 is a stateful
`binary_sensor` emitting `state_changed` with `old_state` and `new_state`, each
with `on`/`off`, UTC `last_changed` (up to six fractional digits), and no restored
flag. Event-only Shelly click representations are deliberately unsupported; do
not guess an entity or translate events without a separate implementation/test.
Confirm Detached mode leaves lamp mains powered. Check HA, Shelly and Apple Home
for competing automations. Confirm both physical directions emit one edge.
Verify startup, reconnect and availability recovery baseline without toggling.
Then verify both bedside lamps plus Mirror invert together and bedroom-off stays
off during party while other lamps continue animating. This is a future manual
plan, not an assertion of live tests performed.

## Input semantics and failure handling

Either valid flip sets all Bedroom lamps off if any **desired** lamp is on,
otherwise all on. Availability never changes that choice. Every member must have
seeded light intent; missing desired rows cause no lamp command. Color and
brightness survive; commands retain the existing 10-second enforcer window.
`controls.toggle` continues to accept explicit targets.

The worker follows the [HA websocket protocol](https://contributors.home-assistant.io/core/internals/websocket-api/) and owns a subscription, not a one-second state poll. It
subscribes before requesting a baseline snapshot. Pre-snapshot events are ignored.
Every new session baselines; unavailable, unknown, missing or restored samples
break continuity. Missing/mismatched old-state continuity baselines the next level
without acting. No offline flip recovery is claimed. Ping failure or queue overflow
closes the session; reconnect retries every five seconds, with a fresh baseline.
Shutdown closes the socket and drains event processing.

A durable per-entity watermark retains HA microsecond timestamp ordering and the
last accepted edge time. Duplicate/out-of-order timestamps cannot act again, even
after restart. Edges less than 150ms after the last accepted edge count as contact
bounce: update the baseline/watermark but do not invert. Flips at least 150ms apart
are processed individually without trailing timer coalescing. A physical flip
inside that interval is intentionally indistinguishable from bounce. This threshold
requires hardware verification before activation.

Group writes and the input watermark commit in one PostgreSQL transaction, guarded
by a transaction-scoped advisory lock. Failed writes roll back both; replay after
commit cannot double-invert. App light commands, alarm light commands, enforcer
snapshot/decision/application, and party ticks share that ordering boundary. The
enforcer cannot adopt a pre-command snapshot over newer desired. A command waits
for an already-running party HA call to finish before committing off; subsequent
ticks skip every desired-off/missing lamp, preserving other lamps' wave positions.
The lock spans bounded HA requests, so a slow HA can delay input/app commands; this
is an intentional correctness tradeoff. External HA/Apple/Shelly writers do not
participate in this lock, which is why ownership verification remains a gate.

Offline tests mock transport/state entirely. Optional real PostgreSQL store contract
tests require an isolated test database (`CORE_PG_TEST_URL`); they are skipped when
that prerequisite is absent. No tests require contacting HA or devices.
