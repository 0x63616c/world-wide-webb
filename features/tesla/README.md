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

The nine vehicle roles are required, including the charge switch. A software update entity is optional; discovery recognizes the default `update.<prefix>_update` name as well as software-update suffixes. When present, its availability, installation status and versions are returned without making other telemetry dependent on it. Canonical names take
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
| softwareUpdate | update (optional) | Software update status and reported versions |

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
with the existing native decoder. Before any successful read, missing, unavailable, unsupported, or malformed
readings return {status:"unavailable",data:null}. After a successful read, the API
returns the complete last known snapshot with `stale:true` and `lastUpdatedAt`.
Snapshots persist in the shared device-state table across process restarts, owned
by vehicle telemetry so the generic HA sync cannot overwrite them. Partial reads
never mix fresh fields with cached fields. Native clients show “Car offline · Last
known state” and disable commands until a fresh reading arrives.

Complete readings return status ready with `stale:false`, `lastUpdatedAt` and
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
The native Tesla app is read-only; its lock indicator reports telemetry and has no action. Clients re-read state and do not automatically retry commands. Vehicle state may
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

## Evee dashboard

The Swift dashboard identifies the owner's original Model Y as **Evee**. A flat,
right-facing side-profile pictogram uses Space Gray for the body and simple wheel
circles, and white for the interior. It is artwork, not live camera imagery.
The summary follows the simple centered layout: title and lock indicator, mileage
without a visible label, car, battery/range and cabin temperature. All native
vehicle UI is read-only; there is no lock button, PIN flow or Details disclosure.
The full odometer and lock descriptions remain available to VoiceOver.

The filled battery bar has a slow moving highlight and soft green glow during
fresh active charging only; Reduce Motion keeps a steady glow. The fill length
always represents the reported charge. `-hybridMotion` enables motion for simulator
fixture review; normal fixture tests remain still. Normal/up-to-date software adds
no banner; available and installing updates do. Installation stays in the Tesla app.

Additional optional roles are discovered independently:

| Role | Matching HA entity | Native use |
| --- | --- | --- |
| vehicleOnline | binary_sensor, status/online, connectivity class | False marks readings as last reported |
| cableConnected | binary_sensor, charge_cable/charger_connected | Available to clients; omitted from the minimal dashboard |
| chargeLimit | number, charge_limit, % | Reported target while actively charging |
| chargeCompleteAt | sensor, time_to_full_charge, timestamp class | Reported completion time while actively charging |
| shiftState | sensor, shift_state/gear (including API-path suffixes) | P/D/R/N → parked/driving/reversing/neutral |

Unknown, unavailable, malformed or missing optional readings stay absent and do
not make the base snapshot unavailable. Missing shift state never means parked;
charge rate in mph is **not vehicle speed**. Reported non-P gear and software installation have distinct read-only presentations.
Older servers/fixtures without these optional fields remain readable.

A read-only inventory on 2026-11-06 verified Evee's cable, charge limit, completion
sensor, connectivity, temperatures, windows/doors, covers and software entities.
The completion sensor was unavailable while unplugged, and **no active shift-state
sensor existed**. Driving presentation is therefore implemented and fixture-tested
but will only appear live after the integration exposes a recognized gear entity.
No HA configuration or real vehicle state was changed. Connectivity false cannot
distinguish sleep from loss of connection; the UI says “Last reported”, not “Asleep”.

Future controls supported upstream include climate, charge start/stop, charge
limit/current, boot/froot, windows, sentry, wake, flash and horn. This redesign
keeps all native vehicle actions unavailable, including lock/unlock and software
installation. Existing backend command endpoints are unchanged. The existing HA integration remains the source rather
than adding a second Fleet OAuth/streaming service.

References: [HA Tesla Fleet](https://www.home-assistant.io/integrations/tesla_fleet/),
[Tesla Fleet Telemetry fields](https://developer.tesla.com/docs/fleet-api/fleet-telemetry/available-data),
[Apple materials](https://developer.apple.com/design/human-interface-guidelines/materials),
[Apple motion](https://developer.apple.com/design/human-interface-guidelines/motion).
