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

All field names below are **verified against the live ASC API** via a smoke
call (2026-07-11): 200 OK, JWT auth works, 55 builds, latest build `68`.

- Build a short-lived ES256 JWT signed with the `.p8` key
  (`ASC_KEY_CONTENT`), header `{ alg: "ES256", kid: ASC_KEY_ID, typ: "JWT" }`,
  payload `{ iss: ASC_ISSUER_ID, aud: "appstoreconnect-v1", iat: now, exp:
  now + ~10min }`. Sign with **Web Crypto** (`crypto.subtle`, ECDSA P-256 /
  SHA-256), which emits the raw R||S signature JWT ES256 requires. (Bun's
  `node:crypto` EC signing with `dsaEncoding: "ieee-p1363"` threw
  `RangeError: Length out of range of buffer` during the smoke test - use
  `subtle`, not `createSign`.)
- `getLatestBuild(): Promise<AscBuild | null>` - GET
  `https://api.appstoreconnect.apple.com/v1/builds` with:
  - `filter[app]=ASC_APP_ID` (`6762095888`)
  - `filter[processingState]=VALID` - only count builds that are actually
    installable (drops PROCESSING/INVALID), which removes the TestFlight
    processing-lag concern
  - `sort=-version`, `limit=1`
  - `include=preReleaseVersion` - to read the marketing version
  - `Authorization: Bearer <jwt>`
- Parse response (verified shape):
  - `data[0].attributes.version` - build number as a **string** (`"68"`);
    parse to int for comparison.
  - `data[0].attributes.uploadedDate` - ISO 8601 with offset
    (`2026-06-17T11:27:37-07:00`) - the "released ago" source.
  - `data[0].attributes.processingState` (`VALID`), `expired`, `expirationDate`
    also available (not required, but `expired` could later flag a stale
    installed build).
  - Marketing version: from the `included[]` array, the `preReleaseVersions`
    entry `.attributes.version` (`"1.0"`). Confirmed present with the include.
- Returns `AscBuild { buildNumber: number, marketingVersion: string,
  uploadedDate: string }` or `null` on any failure (caller keeps last cache).

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

The ASC credentials already exist, committed to `secrets/vault.yaml`
(SOPS-encrypted, values encrypted at rest). Runtime env-name -> vault key:

- `ASC_KEY_ID`      <- `APP_STORE_CONNECT_API__KEY_ID`
- `ASC_ISSUER_ID`   <- `APP_STORE_CONNECT_API__ISSUER_ID`
- `ASC_KEY_CONTENT` <- `APP_STORE_CONNECT_API__P8_CONTENT` (the `.p8` body)

Note: the vault's `APP_STORE_CONNECT_API__APPLE_ID` is the Apple **account
email**, NOT the numeric app id. `ASC_APP_ID` = `6762095888` is not currently a
vault key. Since it is non-sensitive, add it as a plain env/default (a constant
in the ASC client or a non-secret env with default `6762095888`) rather than a
new SOPS entry.

CI (`.github/workflows/ios-build.yml`) already decrypts these and re-exports the
`ASC_*` names, so there is **no new secret to provision**. Secret flow is an
explicit allowlist (verified): SOPS -> k8s Secret -> file mounted at
`/run/secrets/<ENV_NAME>` -> `env.ts` hydrates into `process.env`. Worker shares
`env.ts` via `@control-center/api/worker`. The exact edit points:

1. `infra/src/secrets-map.ts` `apiSecrets` (~L15-28) - add `ASC_KEY_ID`,
   `ASC_ISSUER_ID`, `ASC_KEY_CONTENT` mapped to their vault keys. `workerSecrets`
   spreads `apiSecrets` (~L32), so the worker inherits them automatically.
2. `infra/src/services.ts` - add the three names to the worker `mount([...])`
   list (~L251-264) and the api list (~L224-237) to keep them in lockstep.
3. `products/control-center/api/src/env.ts` - add the three names to
   `SECRET_FILE_ENV` (~L38-52) AND to `envSchema` (~L72-128) as
   `z.string().default("")`; add `ASC_APP_ID` to the schema with default
   `"6762095888"` (non-secret, no file mount needed).

No changes needed in `eso.ts`, `vault.ts`, or `component.ts` - they iterate the
maps/lists generically.

`ASC_APP_ID` is the ASC numeric app resource id (not the bundle id), needed for
`filter[app]`. Value `6762095888` (fastlane log + App Store Connect URL);
confirm it matches SOPS `APP_STORE_CONNECT_API__APPLE_ID`. Not sensitive.

This wiring is lighter than a fresh secret - just extending existing sync.

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

Resolved:
- `ASC_APP_ID = 6762095888`.
- ASC creds already in `secrets/vault.yaml` (SOPS keys `APP_STORE_CONNECT_API__*`)
  and in 1Password `homelab / App Store Connect API` (the `.p8` is the attachment
  `AuthKey_TJ8M46SFSQ.p8`). No new secret to provision.
- ASC response shape verified live (build# = `attributes.version` string,
  `uploadedDate` ISO+offset, marketing via `preReleaseVersions` include,
  `processingState=VALID` filter for installable builds).
- ES256 signing uses Web Crypto (`crypto.subtle`), not Bun `node:crypto`.
- The vault `APP_STORE_CONNECT_API__APPLE_ID` field is the Apple *account email*,
  not the numeric app id; `filter[app]` uses `6762095888`.
