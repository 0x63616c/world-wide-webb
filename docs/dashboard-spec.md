# Control Center — Evee Dashboard spec

Fixed landscape wall panel (iPad Pro): physical panel 1366×1024; board content grid
1366×1000 (`BOARD_W`×`BOARD_H`). Auto-scaled to viewport. Dark, deep
blacks (`#060708`), single signal-green accent (`#5BE37D`), Space Grotesk + Space Mono.
12-col × 6-row bento grid. Source of truth: Claude Design handoff
(`Evee Dashboard.html` + `evee-tiles.jsx` + `evee.css` + `wf-kit.jsx`).

Location: Los Angeles, CA. Exact home coordinates and place name come from the
`HOME_LAT`/`HOME_LON`/`HOME_PLACE_NAME` env (real values in 1Password, item
"Home Location"); the repo ships a public placeholder (LA City Hall) so no home
address lives in source. See `scripts/save-home-location.sh` and CC-mqp.

## Stack (mirrors the `evee` repo)

- **apps/web** — Vite, React 19, TypeScript, Tailwind v4, TanStack Router, tRPC client + React Query.
- **apps/api** — Bun, tRPC v11, Drizzle + Postgres, Zod env. Integrations: Home Assistant, UniFi, Open-Meteo, Tesla (via HA).
- **packages/api** — shared tRPC `AppRouter` type.
- **Tilt** — Postgres (docker-compose) + api (`:4201`) + web (`:4200`). Secrets via `op inject -i tilt/op-secrets.tpl`.

## Grid layout (`gridTemplateAreas`)

```
clock clock clock clock clock  weath weath weath weath  wifi wifi wifi
clock clock clock clock clock  weath weath weath weath  wifi wifi wifi
tesla tesla tesla tesla  hourly hourly hourly hourly  ctrl ctrl ctrl ctrl
tesla tesla tesla tesla  hourly hourly hourly hourly  ctrl ctrl ctrl ctrl
tesla tesla tesla tesla  dogcam dogcam dogcam dogcam  ac   ac   ac   ac
event event event event  dogcam dogcam dogcam dogcam  ac   ac   ac   ac
```

(Per chat final: Next 12 Hours top-middle, Dog Cam bottom-middle — same 4×2 footprint.)

---

## Tiles — data, source, states

### 1. Clock / Greeting  (`clock`)
- **Data:** current time (12h), date, greeting (Good morning/afternoon/evening/night by hour), location label.
- **Source:** client clock (`setInterval` 1s). Location is static config.
- **States:** ticking only. No loading/error (pure client).

### 2. Weather Now  (`weath`)
- **Data:** temp, condition text, hi, lo, feels-like, humidity %, wind mph, sunset time, city.
- **Source:** Open-Meteo `/v1/forecast` (no key). `current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m`, `daily=temperature_2m_max,temperature_2m_min,sunset`, `temperature_unit=fahrenheit`, `wind_speed_unit=mph`, `timezone=auto`.
- **States:** loading (skeleton), success, error (keep last-known, dim). Refetch every 10 min.

### 3. Network / Wi-Fi  (`wifi`)
- **Data:** status (Online/Offline), ssid, 24h down GB, 24h up GB, ping ms, 24×{down,up} hourly series for the mirrored butterfly chart.
- **Source:** UniFi controller (`UNIFI_API_KEY`, `UNIFI_CONTROLLER_URL`, `UNIFI_SITE_ID`) for WAN traffic + health; SSID from `WIFI_SSID`; ping = measured latency to gateway/1.1.1.1.
- **States:** online/offline, loading, error (offline styling). Refetch every 60s.

### 4. Tesla  (`tesla`)
- **Data:** name (Model Y), nick (Evee), locked bool, place label, lat/lon (map marker), charging bool, charge rate mi/hr, battery %, range mi, odometer, cabin temp °F.
- **Source:** Home Assistant Tesla entities — `sensor.*_battery`, `binary_sensor.*_charging`, `*_charge_rate`, `lock.*` / `binary_sensor.*_locked`, `device_tracker.*` (lat/lon), `sensor.*_range`, `sensor.*_odometer`, `sensor.*_inside_temp`. Entity ids resolved at runtime by domain+name match; configurable via env.
- **Map:** recreate the design's lo-fi SVG sketch (no tile API), parked-at-home marker.
- **States:** online / asleep (Tesla sleeps — show last-known + "Asleep"), charging/idle, locked/unlocked, parked/driving, loading, error. Refetch every 60s.

### 5. Dog Cam  (`dogcam`)
- **Data:** snapshot still URL, stream URL, label ("Living Room"), live bool, REC clock.
- **Source:** Home Assistant camera entity — snapshot `/api/camera_proxy/<entity>`, stream via HLS endpoint. **Video feed left as designed-but-stubbed**; APIs (`camera.snapshot`, `camera.streamInfo`) are fully designed.
- **States:** covered (frosted, default), live (revealed snapshot/feed), offline, loading.

### 6. Controls  (`ctrl`)
- **Data:** lamps {on, count, warmth sub}, lights {on}, fan {on, speed sub}, "More" placeholder.
- **Source:** Home Assistant — `light.*` (lamps group + ceiling lights), `fan.*`. Read state; toggle via `light.turn_on/off`, `fan.turn_on/off`. Optimistic UI, reconcile on poll.
- **States:** on/off per control + sub-status, optimistic pending, error (revert). Refetch every 30s.

### 7. Next 12 Hours  (`hourly`)
- **Data:** 12 × {hour label, temp, feels, condition icon (day/night aware)}.
- **Source:** Open-Meteo hourly `temperature_2m,apparent_temperature,weather_code,is_day`, sliced to next 12 from current hour.
- **States:** loading, success, error. Refetch every 10 min (shared with Weather).

### 8. Climate / A/C  (`ac`)
- **Data:** target setpoint (65–80), ambient/current room temp, mode (cool/auto/heat), action (Cooling/Heating/Auto/Idle).
- **Source:** Home Assistant `climate.*` — `current_temperature`, `temperature` (setpoint), `hvac_mode`, `hvac_action`. Set via `climate.set_temperature`, `climate.set_hvac_mode`.
- **States:** cooling/heating/auto/idle, setpoint drag (optimistic, debounced write), loading, error. Refetch every 30s.

### 9. Upcoming Events  (`event`)
- **Data:** list of {name, date → days-until, place}. Show next 3.
- **Source:** Postgres `events` table (Drizzle), seeded (Gorgon City, Chris Lake, Florida 2026, John Summit). Days computed server-side from date in America/Los_Angeles. (Future: HA/Google calendar.)
- **States:** loading, success, empty, error. Refetch every 30 min.

---

## Cross-cutting
- All live data via tRPC queries with React Query `refetchInterval`; mutations (toggles, setpoint) optimistic.
- Graceful degradation: every tile renders with last-known or placeholder on error; never blank.
- HA client: single typed `HomeAssistantClient` (REST `/api/states`, `/api/services`, `/api/template`, `/api/camera_proxy`), 5s timeout, bearer `HA_TOKEN`.
- Tests: vitest unit (services + routers, HA/UniFi/Open-Meteo mocked), component tests per tile (states), one Playwright smoke at 1366×1024.
</content>
</invoke>
