# Tesla HA API (WWW-36, WWW-88)

This API-only feature adds no tiles or changes to existing procedures. Native
clients use GET /trpc/tesla.state and POST /trpc/tesla.command. The web app
continues to work unchanged. The native migration falls back to web if this API
is not deployed.

The existing shared Home Assistant client uses server-side HA_URL and HA_TOKEN.
No Fleet OAuth flow, vehicle credentials, entity IDs, VIN, coordinates, or HA
attributes are sent to the panel. The climate service and Tesla discovery share
`TESLA_ENTITY_PREFIX` from `features/ac/config.ts` (currently `evee`).

## Configure

Set the optional server environment variable TESLA_ENTITIES to a JSON object
with these keys. Supply actual entity IDs in deployment configuration, never in
source control. A valid complete mapping overrides discovery, including for
commands; invalid or unset JSON falls back to discovery.

Discovery reads HA's cached `/api/states` and restricts object IDs to
`${TESLA_ENTITY_PREFIX}_`. It matches domains, suffixes, units, and battery
`device_class`, covering Fleet/Teslemetry names (`battery_level`, `battery_range`,
`charging`, `charger_power`, `inside_temperature`, `lock`, `climate`, `charge`)
and common tesla_custom variants (`battery`, `range`, `charging`,
`temperature_inside`, `charger`). API-path suffixes such as
`charge_state_charging_state` and `climate_state_inside_temp` also work.
Numeric roles require the units in the table. Odometer may need enabling in HA.

All nine roles are required, including the charge switch. Canonical names take
priority; remaining ties use entity ID order, independent of HA response order.
Vehicle lock/climate fallbacks exclude charge-cable/port locks and cabin overheat
protection. Renamed entities that no longer match these conventions require an
explicit mapping. Successful discovery is cached for five minutes, shared by
reads and commands; failures invalidate it so the next request discovers again.
Concurrent requests share an in-flight discovery. Incomplete discovery is not
cached.

| Key | HA domain | Reading / action |
| --- | --- | --- |
| battery | sensor | Percent (%) |
| range | sensor | Battery range (mi or km) |
| charging | sensor or binary_sensor | charging, stopped, complete, disconnected, no_power, starting; binary on/off becomes charging/stopped |
| power | sensor | Charger power (W or kW) |
| odometer | sensor | Odometer (mi or km; may need enabling in HA) |
| temperature | sensor | Inside temperature (°C or °F) |
| lock | lock | locked/unlocked; lock.lock/unlock |
| climate | climate | HVAC mode; climate.turn_on/turn_off |
| chargeSwitch | switch | switch.turn_on/turn_off |

Use the vehicle door lock, not the charge-cable lock; use the vehicle climate,
not cabin overheat protection. These entity types are supported by the official
[HA Tesla Fleet integration](https://www.home-assistant.io/integrations/tesla_fleet/).
Existing compatible HA integrations can use the same mapping. This API reads HA's
cached entity state and does not wake a sleeping vehicle or force a Fleet poll.
HA controls freshness and command signing.

Missing HA_URL or HA_TOKEN returns {status:"unconfigured",data:null}.
Configured HA with incomplete discovery returns, for example,
`{status:"unavailable",reason:"Missing Tesla entities: range, odometer",data:null}`.
The optional reason lists roles only; no entity IDs or upstream errors are exposed.
PanelKit already decodes `unavailable` and ignores extra keys, so this is compatible
with the existing native decoder. Missing,
unavailable, unsupported, or malformed readings return
{status:"unavailable",data:null}. Complete readings return status ready with
batteryPercent, rangeMiles, chargingState, chargePowerKW, locked, climateOn,
cabinFahrenheit, and odometerMiles. Numeric bounds match the native decoder.
Unknown units fail closed; no missing field receives a synthetic reading.

## Commands and PIN

Command bodies contain action and a six-digit pin. Actions are lock, unlock,
climateOn, climateOff, chargeStart, and chargeStop. All six require the persisted
panel PIN on every request. A missing/corrupt settings row rejects the command;
a database outage fails closed. Save the PIN in the existing web Settings first.
The shared settings reader's display fallback is deliberately not used.

This is a panel soft lock, not a new authentication boundary: Cloudflare Access
remains the perimeter, and existing settings procedures retain their behavior.
No PIN is logged, returned, or placed in a query string. Invalid input is rejected
before checking the PIN or calling HA. HA failures return a generic 503.

{accepted:true} means HA accepted the service call, not that the vehicle changed.
Clients re-read state and do not automatically retry commands. Vehicle state may
lag until the integration next updates. The rollout check must confirm the
specific HA entities and command signing setup; no real vehicle commands were
issued during development.

## Verification

- bun run typecheck
- bun run lint
- bun run test:unit
- bun run knip
- bun run apps:check

Fixtures are synthetic. Tests cover configuration, bounds and unit conversion,
all six service targets, malformed/unavailable data, PIN failures, missing settings,
database failures, generic upstream errors, prefix/domain/unit filtering, naming
variants and priorities, discovery expiry, concurrent requests, override precedence,
and recovery after failures. Fixtures do not verify the live HA inventory.
