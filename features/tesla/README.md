# Tesla HA API (WWW-36)

This API-only feature adds no tiles or changes to existing procedures. Native
clients use GET /trpc/tesla.state and POST /trpc/tesla.command. The web app
continues to work unchanged. The native migration falls back to web if this API
is not deployed.

The existing shared Home Assistant client uses server-side HA_URL and HA_TOKEN.
No Fleet OAuth flow, vehicle credentials, entity IDs, VIN, coordinates, or HA
attributes are sent to the panel. The repo's climate service already excludes
the legacy Tesla climate naming prefix; actual production integration availability
must be checked before rollout. The verification Mac only has an orbstack
Kubernetes context, not home-server credentials.

## Configure

Set the optional server environment variable TESLA_ENTITIES to a JSON object
with these keys. Supply actual entity IDs in deployment configuration, never in
source control. There are no naming defaults or discovery guesses.

| Key | HA domain | Reading / action |
| --- | --- | --- |
| battery | sensor | Percent (%) |
| range | sensor | Battery range (mi or km) |
| charging | sensor | charging, stopped, complete, disconnected, no_power, starting |
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

Missing/invalid config returns {status:"unconfigured",data:null}. Missing,
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
- cd apps/api && bunx vitest run
- bun run apps:check

Fixtures are synthetic. Tests cover configuration, bounds and unit conversion,
all six service targets, malformed/unavailable data, PIN failures, missing settings,
database failures, and generic upstream errors.
