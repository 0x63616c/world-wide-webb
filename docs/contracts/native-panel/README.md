# Additive native-panel API fields (WWW-42)

These additions use the existing plain tRPC v11 endpoints at `/trpc/` with no
transformer. Existing procedures, inputs, fields, types and aggregate behavior
remain unchanged. Every added response field is optional; clients must accept
its absence. The web app and Expo panel need no changes.

The fixtures are synthetic HTTP success envelopes, checked against the generated
app router by `apps/api/src/__tests__/native-panel-contract.test.ts`. The `legacy`
fixtures intentionally omit all additions. They contain no device captures,
credentials or personal data. Unit tests separately verify the state mapping and
device writes.

## Fan capabilities (WWW-87)

`controls.list` and controls mutation responses add optional `fan.modes`
(`("off" | "auto" | "on")[]`) and `fan.mode` (`string | null`). Native clients
without capabilities offer Auto/On only. Off is included only when the configured
climate entity advertises `off` in HA's `fan_modes`; the worker persists that
reported capability in the thermostat device-state row.

`POST /trpc/controls.setFanMode` takes `{ "mode": "off" | "auto" | "on" }`.
It updates desired fan mode and opens the command window; unsupported Off fails
without changing desired state. The existing `controls.toggle` input is unchanged:
`{ "key": "fan", "on": false }` still means Auto. `fan.sub` remains the status
label, so Auto intent with HVAC off may display Off; segment selection uses
`fan.mode`. While conditioning masks fan drift, `fan.pending` is false.

## Controls

`GET /trpc/controls.list` still accepts no input or `{}`. The same additions also
appear in the existing controls mutations' shared state response:

```ts
// Added inside the existing `lamps` aggregate:
perLamp?: {
  id: string;
  name: string;
  on: boolean;
  brightness: number;
  color?: { rgb: [number, number, number] }
        | { xy: [number, number] }
        | { kelvin: number };
}[];
speed?: "slow" | "medium" | "fast";
colorSlot?: "red" | "blue" | "custom";
```

- `perLamp` uses the same desired-over-reported `device_state` snapshot as the
  aggregate, with stable registry IDs and display names in registry order.
  Fixtures/ceiling lights are excluded. Lamps without any observed or desired
  state are excluded; no rows yields `[]`. A failed device-state read omits the
  array and keeps the existing aggregate fallback.
- `on` follows the aggregate's availability rule: unavailable lamps read false,
  even if their desired state says on. `brightness` is the rounded 0–100 percent
  conversion of HA's 0–255 level, retaining last-known brightness for off lamps
  and using the aggregate's zero fallback for an unknown level. `color` is
  omitted when unknown; known RGB (0–255), CIE xy, or kelvin values are preserved
  without lossy conversion. During party it remains the same effective state
  used by the aggregate, rather than a separate live animation read.
- `speed` reports the persistent party setting using the worker's shared speed
  normalization (`medium` when the stored speed is absent or unrecognized).
  It is omitted outside party or when the mode cannot be read. It reports
  configured intent, not confirmation that the worker is running.
- `colorSlot` is the unique saved colour whose RGB or xy matches every on-lamp.
  Edited saved colours are respected. It is omitted for party, all-off, white,
  mixed/unknown colours, or ambiguous duplicate saved colours. It does not
  change `activeScene` or persist a second selection state.

## Sonos

`GET /trpc/sound.soundSystem` still accepts no input or `{}`. Each existing room
can now include:

| Field | Type | Meaning |
| --- | --- | --- |
| `position` | optional number | Nonnegative finite seconds from HA `media_position`; zero and fractions are retained. |
| `duration` | optional number | Nonnegative finite seconds from HA `media_duration`, independent of position. |
| `positionAt` | optional ISO string | HA `media_position_updated_at`, normalized to UTC with milliseconds; only included with a valid position and timestamp. |

All values come from the existing media-player snapshot, without additional
device requests. Unknown, unavailable and off players omit all three. Sources
such as line-in or TV may omit them. Missing/invalid values are omitted, never
invented. `positionAt` is the time the position was sampled by HA, **not** the
API query time or the entity's unrelated `last_updated`. Clients may advance a
playing position from this timestamp, clamp to a known duration, and must not
advance paused playback. See the [HA media-player property contract](https://contributors.home-assistant.io/core/entities/media-player/).

`POST /trpc/sound.sonosSeek` is a new mutation:

```json
{ "room": "media_player.example", "positionSeconds": 12.5 }
```

Both fields are required on this new procedure. No existing input gains a
requirement. `room` is the HA media-player entity ID returned in `room.uuid`
(use `coordinatorUuid` for grouped playback), not its display name or IP.
`positionSeconds` is a finite nonnegative number; zero and fractional seconds
are accepted. Invalid/missing inputs return `BAD_REQUEST` before any write.

Seek uses the same `publicProcedure` and HA error middleware as existing Sonos
mutations, and the same HA client to call `media_player.media_seek` with
`{ entity_id: room, seek_position: positionSeconds }`. There is no new auth path,
device client, retry or simulated success. HA failures map to
`SERVICE_UNAVAILABLE`; other failures remain errors. Unsupported sources and
positions beyond the track length are left to HA/device validation.

As with existing void Sonos mutations, successful HTTP output is
`{ "result": {} }`; poll `soundSystem` for the updated state. GET inputs use a
JSON-encoded `input` query parameter; POST inputs are JSON bodies with
`Content-Type: application/json`.

## Generation and checks

Run `bun run apps:gen` then `bun run apps:check`. These changes extend existing
router facets and do not add a table, so regeneration leaves the checked-in
router/schema aggregates unchanged and no database migration is needed.

```sh
source .job.env
bun run apps:gen
bun run apps:check
bun run typecheck
bun run test:unit
bun run lint
```
