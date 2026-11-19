# Wall switches

Two Shelly 1 Mini Gen4 rockers report each flip to Home Assistant as an on/off
`binary_sensor`. Control Center subscribes to HA's websocket for each one and decides what a
flip does. Behaviour is chosen in the app under **Settings → Wall Switches** and stored
server-side (`settings` row `wallSwitches`, `GET`/`PATCH /api/v1/switches`).

| Switch | Input entity | Source | Shelly mode |
| --- | --- | --- | --- |
| Bedroom | `binary_sensor.shelly_bedroom_input_0` | Homelab `bedroomSwitchInput` → `BEDROOM_SWITCH_INPUT_*` env | see device |
| Front door | `binary_sensor.overhead_lights_input_0` | `wall_switches::FRONT_DOOR_INPUT`, active whenever HA is configured | `flip`: the relay switches the overheads locally |

Shelly configs as found on 2026-11-18 are backed up outside Git on Calum's Mac in
`~/.local/share/shelly-config-backups/2026-11-18/`.

## Modes

Modes are cumulative. Defaults keep the previous behaviour: Bedroom **Room only**, Front door **Off**.

- **Off**: flips are logged only.
- **Room only**: a flip toggles the bedroom lamps (all three on if none are on, otherwise off).
  The front door does nothing extra; its Shelly already toggles the overheads.
- **Gestures**: flips inside the gesture window count up. A double flip runs the double-flip
  action (default: everything off if anything was on before the gesture, otherwise everything on;
  optionally including the overhead and cabinet relays). A triple flip runs the chosen scene
  (default party mode). The first flip still acts immediately, so normal flips never wait.
- **Smart**: a single flip first stops a ringing or snoozed alarm, otherwise ends party mode,
  otherwise toggles the room. Lamps turned on during the night window use the night brightness
  and colour temperature (house time zone from Settings).

Edges closer than the bounce filter (default 150 ms) to the last accepted edge are ignored.
Window 0 turns gestures off.

## Consistency

Each edge commits its checkpoint (HA microsecond timestamp, gesture count, room state before the
gesture), any bedroom lamp intents and its flip-log row in one SQLite transaction under the light
gate. Duplicate or out-of-order timestamps never act again, including after restart. Gesture,
scene, party and alarm actions run after that commit through the existing light command and alarm
paths, so a replayed edge cannot repeat them; a crash between commit and action drops the action.
Every new websocket session rebaselines; no offline flips are recovered.

New light intents (app commands and switch edges) wake the light enforcer immediately instead of
waiting for its one-second tick.

The flip log keeps 30 days and the Settings page shows the latest 100 with the gap since the
previous accepted edge, for tuning the window and bounce filter.

The confirmation blink sends HA `light.turn_on` with `flash: short` to the bedroom lamps after a
double flip; it is experimental and untested on the Hue lamps.
