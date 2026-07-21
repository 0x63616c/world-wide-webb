# Weight Tile & Page — Design

Track Calum's body weight from the Renpho ES-CS20M scale, from 2026-07-21 onward
(no historical backfill), displayed on the wall panel as a board tile with a
full-screen detail page.

## Data flow

```
Renpho ES-CS20M ─BLE─▸ Shelly 1 Mini Gen4 (BT scanner mode)
  ─▸ Home Assistant (renpho_fitness_scale_ble custom integration, HACS)
  ─▸ control-center worker poll (HA REST, same client as climate/weather)
  ─▸ Postgres weight_measurement
  ─▸ weight tRPC router ─▸ WeightTile / WeightPage
```

No Renpho cloud credentials, no app coupling, no Apple Health. Data appears
seconds after stepping on the scale.

### HA side (manual/one-time)

- Enable Bluetooth scanner (active) on a Shelly Gen4 within BLE range of the
  scale (HA → Shelly device → Configure).
- Install `ronnnnnnnnnnnnn/renpho_fitness_scale_ble` via HACS custom repo.
- Integration exposes weight + body-comp sensors and does multi-user matching
  (adaptive weight-history matching), which filters most guest weigh-ins
  upstream.

## Storage

Raw, append-only. Every measurement the HA sensor reports becomes a row; no
write-time collapsing.

`weight_measurement`:

- `id` — `wm_<id>`
- `measured_at` — timestamptz, from the HA sensor's last-update
- `weight_kg` — numeric, canonical metric; lb is presentation-layer only
- `body_metrics` — nullable jsonb (fat/muscle/water/BMR as reported); stored but
  not currently displayed
- `source` — text, `ha_ble` for now
- `excluded_reason` — nullable text; non-null rows are hidden from all reads

Unique on `measured_at` (sensor timestamp) for ingest idempotency.

## Ingest rules

- Worker cycle polls the HA weight sensor; inserts a row when the sensor's
  timestamp is new. Missed days are simply absent — no fake rows.
- Sanity band: a measurement deviating more than ~12 lb (5.4 kg) from the 14-day
  rolling median is stored with `excluded_reason` set (e.g. `sanity_band`) —
  flagged, never deleted. With no prior history (first 1–2 readings), the band
  is inactive.

## Read model

- Daily display value = median of that day's included measurements (kills
  double-weigh anomalies).
- `weight.summary` tRPC query: `{ range: "7d" | "30d" | "all" }` → daily series
  + latest + low/high/average/change for the window. Change = latest vs
  earliest daily value inside the window.

## UI (concepts approved in Storybook: `Experiments/Weight Tile`)

- **Tile** (3x2, registry `tile_weight`, label "Weight"): lucide `Weight`
  glyph (added to the Icon map), 30d sparkline on top, hero number + `lb` +
  recency label bottom ("Today"/"Yesterday"/short date), `↓x.x lb / 30d` badge
  top right (accent when down, muted when up).
- **Detail page** (full-screen page, NOT a modal — see AGENTS.md invariant):
  PageHeader (back + "Weight" + current weight top right), centered 7d/30d/All
  Segmented range picker, chart filling the remaining height with min/max
  gridlines + selective labels, Low/High/Average/Change stat row pinned at the
  bottom.
- Skeleton/error states per house tile pattern; no invented values. Empty
  history (day one) renders the skeleton until the first weigh-in lands.

## Out of scope (deliberately)

- Body-comp display (fat/muscle/water/BMR) — stored, not shown.
- Excluded-readings review UI. Unflag via SQL if ever needed.
- Unit setting (lb hardcoded at display), goals, annotations, Apple Health.
