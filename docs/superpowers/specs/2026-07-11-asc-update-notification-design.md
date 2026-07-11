# ASC Update-Available Notification - Design

**Date:** 2026-07-11
**Product:** control-center
**Status:** Approved design, pre-implementation

## Problem

The Control Center wall panel runs a native iOS app that is a thin Capacitor
kiosk shell. The shell loads a hosted URL, so the **web bundle** updates OTA on
every deploy (already handled by `web/src/lib/version-check.ts` polling
`/version.json`). The **native shell**, however, only changes when a new build
is uploaded to TestFlight and installed on the device. Today nothing tells the
operator that the installed native app is behind the latest TestFlight build.

We want a non-intrusive notification when a newer TestFlight build exists,
showing how long ago it was released and how many builds behind the installed
app is.

## Scope

- **In:** Detect newer TestFlight build via App Store Connect (ASC) API, cache
  it server-side, expose it over tRPC, surface a dismissible banner on the web
  board.
- **Out:** Public App Store / iTunes Lookup detection (this app is not a real
  public release - TestFlight only). Auto-updating the native app. Any GitHub
  Actions-based detection (considered and dropped in favour of ASC as the
  authoritative source of the installable build).

## Decisions (locked)

| Question | Decision |
|---|---|
| Detection source | ASC API, TestFlight builds only |
| Poll location | Worker cycle, every 60s |
| Serving | API reads a server-side cache the worker writes |
| UI surface | Dismissible banner via existing `useNotifications` store |

Rate-limit note: ASC allows ~3600 req/hr per team key. A 60s poll is 1440
req/day (~60/hr), ~1.7% of budget - comfortably safe. 60s is faster than
strictly needed for a weekly-ish build cadence, but the user chose it and cost
is a non-issue.

## Architecture

```
[worker: asc-version-poll, intervalMs 60_000]
   -> ASC API  GET /v1/builds?filter[app]=<ASC_APP_ID>&sort=-version&limit=1
   -> upsert latest build into DB cache row
[api: tRPC system.appUpdateStatus (query)]
   -> read cache row -> { buildNumber, marketingVersion, uploadedDate, fetchedAt }
[web board]
   -> @capacitor/app App.getInfo() -> installed { build, version }
   -> compare installed.build vs cache.buildNumber
   -> if latest > installed: raiseNotification(banner); else clearNotification
```

Worker and API are separate deployables/pods, so the cache must be a **shared
store** (DB row), not in-process memory. This mirrors the existing
`weather-ingest` worker → DB → `weather` router read path.

## Components

### 1. `@capacitor/app` plugin (web)

- Add `@capacitor/app` to `products/control-center/web`.
- `App.getInfo()` returns `{ build, version, name, id }`. `build` =
  `CFBundleVersion` (the TestFlight build number); `version` =
  `CFBundleShortVersionString` (marketing version).
- On the web (non-native) platform `getInfo` is unavailable - detect via
  `Capacitor.isNativePlatform()` and skip the whole check in browser/dev.

### 2. ASC client - `api/src/services/asc.ts`

- Build a short-lived ES256 JWT signed with the `.p8` key
  (`ASC_KEY_CONTENT`), header `{ alg: "ES256", kid: ASC_KEY_ID, typ: "JWT" }`,
  payload `{ iss: ASC_ISSUER_ID, aud: "appstoreconnect-v1", exp: now+ ~10min }`.
- `getLatestBuild(): Promise<AscBuild | null>` - GET
  `https://api.appstoreconnect.apple.com/v1/builds` with
  `filter[app]=ASC_APP_ID`, `sort=-version`, `limit=1`, `Authorization:
  Bearer <jwt>`.
- Parse response: `data[0].attributes.version` (build number string),
  `data[0].attributes.uploadedDate` (ISO). Marketing version comes from the
  related `preReleaseVersion`/`version` include if needed, otherwise the build's
  own `attributes.version` string is the build number and marketing version can
  be read from the app's live `CFBundleShortVersionString` reported by the
  client (we already have installed `version`); store what ASC returns.
- Returns `null` on any failure (caller keeps last cache).

### 3. Worker cycle - `asc-version-poll`

- Cycle function lives in the api `worker` barrel (`@control-center/api/worker`)
  alongside the other worker cycles, imported and registered in
  `products/control-center/worker/src/index.ts` with `intervalMs: 60_000`,
  `runOnStart: true`.
- On each run: call `getLatestBuild()`. If non-null, upsert the cache row. If
  null, log a structured warning and leave the existing row untouched (no
  flap).

### 4. Cache store (DB)

- Single-row (or keyed) cache holding the latest known build:
  `{ buildNumber: number, marketingVersion: string, uploadedDate: string
  (ISO), fetchedAt: string (ISO) }`.
- Implement as a small dedicated table `asc_build_status` (or a generic
  settings/KV row if one already exists - follow whatever `weather-ingest`
  uses for its persisted state). Decide during plan by inspecting the existing
  persistence layer; prefer the lightest option consistent with current
  patterns.

### 5. tRPC `system` router - `api/src/trpc/routers/system.ts`

- New router modelled on `health.ts`.
- `appUpdateStatus` query returns the cache row or `null` if never populated:
  `{ buildNumber, marketingVersion, uploadedDate, fetchedAt } | null`.
- Register in `api/src/trpc/routers/index.ts`.

### 6. Banner (web)

- A small hook/effect (e.g. `web/src/lib/useAppUpdateCheck.ts`) that:
  1. Reads installed build via `@capacitor/app` once on mount (native only).
  2. Polls `system.appUpdateStatus` (reuse the existing tRPC/query cadence;
     a slow poll - e.g. 5 min - is plenty since the worker is the fast path).
  3. Computes `behind = latestBuild - installedBuild`.
  4. If `behind > 0`: `raiseNotification({ id: "app-update", message: "Update
     available", detail: "<marketing> (<build>) · <behind> build(s) behind ·
     released <relative> ago" })`. Else `clearNotification("app-update")`.
- Banner rendering reuses the `ConnectionLostBanner` pattern (top-right,
  absolute, dismissible). Dismiss clears for the session; it reappears on next
  load if still behind.

## "Versions behind" computation

Build numbers increment by exactly 1 per build (Fastlane Fastfile:
`latest_testflight_build_number + 1`, `initial_build_number: 48`). Therefore
`behind = latestBuildNumber - installedBuildNumber` is exact and contiguous. No
need to store the full build list. `released ... ago` is derived client-side
from the latest build's `uploadedDate`.

Edge cases:
- `installed >= latest` → `behind <= 0` → no banner.
- Cache `null` (never polled) → no banner.
- Installed build unknown (browser/dev) → skip entirely.

## Secrets / infra

`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_CONTENT` currently exist only as GitHub
Actions / Fastlane secrets. To run the poll at runtime they must be wired into
the **worker** (and api if it ever signs) environment:

- Add `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_CONTENT`, `ASC_APP_ID` to
  `api/src/env.ts` - the `SECRET_FILE_ENV` hydration list and the Zod schema.
- Provision the secret via Pulumi so it reaches the worker pod (follow the
  existing secret wiring, e.g. how `HA_TOKEN` / `UNIFI_API_KEY` are provided).
- `ASC_APP_ID` is the ASC numeric app resource id (not the bundle id) - needed
  for `filter[app]`. Capture it during implementation.

This secret wiring is the main new infrastructure work.

## Error handling

- ASC request failure → return `null`, keep last cache row, structured log
  warning. Banner state unchanged (no flapping on transient ASC errors).
- Cache never populated → API returns `null` → no banner.
- `@capacitor/app` unavailable (non-native) → skip client check silently.
- JWT/`.p8` misconfiguration → surfaces as ASC 401; logged, cache untouched.

## Testing

- **ASC client:** JWT header/payload correctness (alg, kid, iss, aud, exp
  bound), response parsing (extract build number + uploadedDate), failure →
  `null`.
- **Worker cycle:** mock ASC returning a build → asserts cache upsert; ASC
  returns `null` → cache row unchanged.
- **Compare logic:** `behind` calc; edge cases (installed > latest → 0;
  installed == latest → 0; cache null → no banner).
- **tRPC:** `appUpdateStatus` returns cache row / null.

## Open items for the plan phase

1. Confirm the exact persistence pattern `weather-ingest` uses and match it for
   the cache store (dedicated table vs KV row).
2. Capture the real `ASC_APP_ID`.
3. Confirm the marketing-version source (ASC build include vs installed value).
