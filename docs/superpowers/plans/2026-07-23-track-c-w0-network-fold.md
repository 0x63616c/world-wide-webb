# W0 — Fold `tile_wifi` (Network) into `features/network/` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Network tile (`tile_wifi`) from scattered `apps/*` locations into a self-contained `features/network/` App, re-proving the C7 fold pattern with zero shared-substrate pre-work.

**Architecture:** Mirror `features/guest-wifi/` exactly. The feature owns its tile face (`web.tsx`), its tRPC facet (`api.ts` — the `network` router key), its domain logic (`service.ts`), and its config slice (`config.ts`). It builds its own UniFi client from `@www/core` (`createUnifiClient`) rather than `apps/api`'s env-aware singleton, so it never imports `apps/api` (Biome `noRestrictedImports` boundary). The codegen (`bun run apps:gen`) collects the manifest + api facet into `features/_generated/*.gen.ts`; `tile_wifi` flips from `source:"registry"` to `source:"feature"`.

**Tech Stack:** TypeScript, Bun, tRPC v11, drizzle (not used here — no tables), Vitest, React (tile face), `@www/core` UniFi client, `@app-kit` facet brands.

## Global Constraints

- `features/* → apps/api/*` imports are BANNED (Biome `noRestrictedImports`). The feature reaches the tRPC runtime ONLY through `@app-kit/server`; it reaches UniFi ONLY through `@www/core`.
- Never hand-edit `features/_generated/*`. Run `bun run apps:gen`; `bun run apps:check` fails on drift.
- Config slice reads the already-hydrated `process.env` with safe zod defaults (mirror `features/guest-wifi/config.ts`); never import `apps/api`'s `env`.
- Tile coords are copied VERBATIM from the registry entry: `worldCol: 35, worldRow: 27, cols: 3, rows: 3`, label `"Network"`, id `tile_wifi`. Not `guestExposed`, not `home`.
- api image build gotcha: `bun build` reads the CWD's tsconfig — Docker builds `cd apps/api` first (memory `bun-build-alias-needs-cwd-tsconfig`). No change needed here, but do not move the root tsconfig `paths`.
- This is a REFACTOR: no behavior changes. The existing tests are the safety net — they move with the code and must stay green. `git mv` verbatim files; change only the import lines called out.
- Commit + push to `main` after each green task (parallel-session culture): `git pull --rebase --autostash` before push; stage EXPLICIT paths, never `git add -A`; verify `git show --stat HEAD`.

---

## File Structure

Created under `features/network/`:
- `config.ts` — zod config slice: `WIFI_SSID`, `WIFI_GUEST_SSID`, `WIFI_PASSWORD`, `UNIFI_API_KEY`, `UNIFI_CONTROLLER_URL`, `UNIFI_SITE_ID`. Mirrors `features/guest-wifi/config.ts`.
- `service.ts` — moved verbatim from `apps/api/src/services/network-service.ts`; only the UniFi import + the `env`-derived SSID change.
- `api.ts` — the `network` tRPC facet: `status` + `guestWifiQr` procedures + the pure `buildWifiQrPayload`/`escapeWifiQrValue` helpers, wrapped in `defineApi(router({ network: ... }))`. Builds its own UniFi client + reads SSIDs from `./config`.
- `web.tsx` — moved `NetworkTile` (face) + `NetworkTileView` (view). Exports `NetworkTile`, `NetworkTileView`.
- `manifest.ts` — `defineApp` with the tile placement.
- `service.test.ts` — moved from `apps/api/src/__tests__/network.test.ts`, imports repointed.
- `web.test.tsx` / `web-view.test.tsx` — moved `NetworkTile.test.tsx` / `NetworkTileView.test.tsx` (+ `NetworkTileView.stories.tsx` if the storybook-test harness requires colocated stories).

Deleted:
- `apps/api/src/services/network-service.ts`
- `apps/api/src/trpc/routers/network.ts`
- `apps/web/src/components/tiles/NetworkTile.tsx`, `NetworkTileView.tsx`, `NetworkTileView.stories.tsx`, `__tests__/NetworkTile.test.tsx`, `__tests__/NetworkTileView.test.tsx`, `__tests__/NetworkTileView.stories.test.tsx`
- `apps/api/src/__tests__/network.test.ts`

Modified:
- `apps/api/src/trpc/routers/index.ts` — drop the `networkRouter` import + the `network: networkRouter` key from `baseRouter` (it now arrives via `featureAppRouter`).
- `apps/web/src/lib/tile-registry.ts` — import `networkManifest`, add to `FEATURE_MANIFESTS`, delete the `tile_wifi` `REGISTRY_ENTRIES` block + the `NetworkTile`/`NetworkTileView` imports.

Keep unchanged: `features/guest-wifi/web.tsx:48` still calls `trpc.network.guestWifiQr` — it resolves through the generated `featureAppRouter` once `network` is a feature key, so no edit needed. (Relocating `guestWifiQr` into the guest-wifi feature is a deliberately deferred follow-up, out of scope — see end.)

---

### Task 1: Backend fold — `config.ts`, `service.ts`, `api.ts`, remove old router (atomic)

This task must be atomic: the moment `features/network/api.ts` exports the `network` facet AND `apps:gen` regenerates `router.gen.ts`, the base router's `network: networkRouter` becomes a duplicate key under `mergeRouters` — so the old key is removed in the same commit.

**Files:**
- Create: `features/network/config.ts`, `features/network/service.ts`, `features/network/api.ts`, `features/network/service.test.ts`
- Modify: `apps/api/src/trpc/routers/index.ts`
- Delete: `apps/api/src/services/network-service.ts`, `apps/api/src/trpc/routers/network.ts`, `apps/api/src/__tests__/network.test.ts`

**Interfaces:**
- Consumes: `@www/core` → `createUnifiClient`, `UnifiClient`, `UnifiStatus`, `UnifiTrafficBucket`, `UnifiHealth`; `@app-kit` → `defineApi`; `@app-kit/server` → `publicProcedure`, `router`.
- Produces: `features/network/api.ts` exports `const api` (branded facet, top-level key `network` with `status` + `guestWifiQr`). `features/network/service.ts` exports `getNetworkStatus`, `NetworkStatus`, `NetworkConnectivity`, `DEMO_NETWORK`. `features/network/api.ts` also exports `buildWifiQrPayload` (used by tests).

- [ ] **Step 1: Create the config slice**

Create `features/network/config.ts` (mirror of `features/guest-wifi/config.ts`, with the two SSID keys the network tile needs):

```ts
/**
 * The network feature's own config slice (Track C, W0). Reads the already-
 * hydrated process.env (apps/api's env.ts runs docker-secret hydration before
 * any feature is imported) and validates just the keys this feature needs.
 * Never reaches into apps/api's `env`. Safe defaults so importing the branded
 * facets during codegen never throws before real values are wired.
 */
import { z } from "zod";

export const config = z
  .object({
    WIFI_SSID: z.string().default(""),
    WIFI_GUEST_SSID: z.string().default(""),
    WIFI_PASSWORD: z.string().default(""),
    UNIFI_API_KEY: z.string().default(""),
    UNIFI_CONTROLLER_URL: z.string().url().default("https://192.168.0.1"),
    UNIFI_SITE_ID: z.string().default("default"),
  })
  .parse(process.env);
```

- [ ] **Step 2: Move the service (verbatim) and repoint two imports**

```bash
git mv apps/api/src/services/network-service.ts features/network/service.ts
```

In `features/network/service.ts`, replace the UniFi import block:

```ts
// BEFORE
import { env } from "../env";
import type { UnifiClient } from "../integrations/unifi";
import { UnifiStatus, unifi } from "../integrations/unifi";

// AFTER
import type { UnifiClient } from "@www/core";
import { createUnifiClient, UnifiStatus } from "@www/core";
import { config } from "./config";

// module-level singleton built from this feature's config (replaces apps/api's env-aware `unifi`)
const unifi = createUnifiClient({
  apiKey: config.UNIFI_API_KEY,
  baseUrl: config.UNIFI_CONTROLLER_URL,
  siteId: config.UNIFI_SITE_ID,
});
```

And replace the one `env` reference inside `getNetworkStatus` (the SSID line):

```ts
// BEFORE
ssid: env.WIFI_SSID || "Home",
// AFTER
ssid: config.WIFI_SSID || "Home",
```

Everything else in the file (types, `DEMO_NETWORK`, `bytesToGbString`, `getNetworkStatus` body) is unchanged.

- [ ] **Step 3: Create the api facet**

Create `features/network/api.ts` — moves the router from `apps/api/src/trpc/routers/network.ts`, keeps `buildWifiQrPayload`/`escapeWifiQrValue` (pure, exported for tests), reads SSIDs from `./config`, wraps in `defineApi`:

```ts
/**
 * tRPC `network` facet (Track C, W0). The Network tile's stats surface plus the
 * guest-network QR payload. Reaches the tRPC runtime ONLY through
 * @app-kit/server and UniFi ONLY through the feature's own service — never
 * apps/api. Codegen collects the top-level key `network` off `api._def.record`.
 */
import { defineApi } from "@app-kit";
import { publicProcedure, router } from "@app-kit/server";
import { z } from "zod";
import { config } from "./config";
import { getNetworkStatus, NetworkConnectivity } from "./service";

/** Escape a value for a WIFI: QR payload — backslash, semicolon, comma, colon
 * and double-quote are structural and must be backslash-escaped. */
function escapeWifiQrValue(value: string): string {
  return value.replace(/([\\;,:"])/g, "\\$1");
}

/** The full WIFI: join payload, or "" when no SSID is configured. Pure so the
 * escaping is unit-testable. SSID/password exist ONLY inside this payload. */
export function buildWifiQrPayload(ssid: string, password: string): string {
  if (!ssid) return "";
  if (!password) return `WIFI:T:nopass;S:${escapeWifiQrValue(ssid)};;`;
  return `WIFI:T:WPA;S:${escapeWifiQrValue(ssid)};P:${escapeWifiQrValue(password)};;`;
}

const trafficBucketSchema = z.object({
  down: z.number().describe("Download relative value for the butterfly chart"),
  up: z.number().describe("Upload relative value for the butterfly chart"),
});

const networkStatusSchema = z.object({
  status: z
    .enum([NetworkConnectivity.Online, NetworkConnectivity.Offline])
    .describe("WAN connectivity status"),
  ssid: z.string().describe("Primary Wi-Fi SSID from config WIFI_SSID"),
  down: z.string().describe("24 h WAN download in GB (e.g. '12.4')"),
  up: z.string().describe("24 h WAN upload in GB (e.g. '3.1')"),
  ping: z.number().int().describe("Round-trip latency to gateway in ms"),
  traffic: z
    .array(trafficBucketSchema)
    .describe("Hourly buckets for the mirrored butterfly chart; 24 when live, 0 when not yet available"),
});

const networkRouter = router({
  status: publicProcedure
    .input(z.object({}).optional())
    .output(networkStatusSchema)
    .query(async () => {
      const result = await getNetworkStatus();
      return { ...result, ping: Math.round(result.ping) };
    }),
  guestWifiQr: publicProcedure
    .input(z.object({}).optional())
    .output(
      z.object({
        qr: z.string().describe("WIFI: join payload for the guest network, '' when unconfigured"),
      }),
    )
    .query(() => ({ qr: buildWifiQrPayload(config.WIFI_GUEST_SSID, config.WIFI_PASSWORD) })),
});

/** The branded `api` facet — single top-level key `network`. */
export const api = defineApi(router({ network: networkRouter }));
```

- [ ] **Step 4: Delete the old router and drop it from the base router**

```bash
git rm apps/api/src/trpc/routers/network.ts
```

In `apps/api/src/trpc/routers/index.ts`, remove the import line `import { networkRouter } from "./network";` and remove the `network: networkRouter,` line from the `baseRouter` object. Leave `appRouter = mergeRouters(baseRouter, featureAppRouter)` — `network` now arrives via `featureAppRouter`.

- [ ] **Step 5: Move and repoint the backend test**

```bash
git mv apps/api/src/__tests__/network.test.ts features/network/service.test.ts
```

Repoint the three imports at the top of `features/network/service.test.ts`:

```ts
// BEFORE
import { createUnifiClient } from "../integrations/unifi";
import { DEMO_NETWORK, getNetworkStatus, NetworkConnectivity } from "../services/network-service";
import { buildWifiQrPayload } from "../trpc/routers/network";

// AFTER
import { createUnifiClient } from "@www/core";
import { DEMO_NETWORK, getNetworkStatus, NetworkConnectivity } from "./service";
import { buildWifiQrPayload } from "./api";
```

- [ ] **Step 6: Regenerate and run the backend tests**

Run:
```bash
bun run apps:gen
bun run typecheck
bun vitest run features/network/service.test.ts
```
Expected: `apps:gen` rewrites `features/_generated/router.gen.ts` to include `network`; typecheck passes; all moved tests pass (DEMO_NETWORK, getNetworkStatus, buildWifiQrPayload, UnifiClient.*). If typecheck flags a leftover `apps/api` import of `networkRouter`/`network-service`, fix it (there should be none — grep `network-service` and `routers/network` to confirm zero references).

- [ ] **Step 7: Verify no duplicate router key + dep boundary**

Run:
```bash
bun run apps:check
bun run lint
```
Expected: `apps:check` passes (validator: no dup router-key/id/table, 1 home tile, no rect overlap, guestExposed↔allowlist). `lint` passes — the Biome `noRestrictedImports` rule confirms `features/network/*` has no `apps/api` import.

- [ ] **Step 8: Commit**

```bash
git pull --rebase --autostash
git add features/network/config.ts features/network/service.ts features/network/api.ts features/network/service.test.ts features/_generated/ apps/api/src/trpc/routers/index.ts
git rm --cached apps/api/src/services/network-service.ts apps/api/src/trpc/routers/network.ts apps/api/src/__tests__/network.test.ts 2>/dev/null || true
git commit -m "refactor(track-c): W0 fold network backend into features/network (api+service+config)"
git show --stat HEAD   # verify ONLY intended paths
git push
```

---

### Task 2: Frontend fold — `web.tsx`, `manifest.ts`, registry rewire (atomic)

Atomic because moving `NetworkTile`/`NetworkTileView` out of `apps/web/src/components/tiles/` breaks the `tile-registry.ts` import until the registry is rewired to the manifest in the same commit.

**Files:**
- Create: `features/network/web.tsx`, `features/network/manifest.ts`, `features/network/web.test.tsx`, `features/network/web-view.test.tsx`
- Modify: `apps/web/src/lib/tile-registry.ts`
- Delete: the six `apps/web/src/components/tiles/NetworkTile*` / `NetworkTileView*` files (component, view, stories, and the three `__tests__` files)

**Interfaces:**
- Consumes: `features/network/api.ts` (via `trpc.network.status` at runtime — no direct import); `@/components/ui`, `@/lib/hooks`, `@/lib/trpc`, `@/lib/useTileQuery` (apps/web aliases — allowed from a feature web facet, same as `features/guest-wifi/web.tsx`).
- Produces: `features/network/web.tsx` exports `NetworkTile`, `NetworkTileView`. `features/network/manifest.ts` default-exports the branded `AppManifest` referencing those two components.

- [ ] **Step 1: Move the tile face + view verbatim**

```bash
git mv apps/web/src/components/tiles/NetworkTile.tsx features/network/web.tsx
git mv apps/web/src/components/tiles/NetworkTileView.tsx features/network/NetworkTileView.tsx
```

In `features/network/web.tsx`, change the relative view import:
```ts
// BEFORE
import { NetworkTileView } from "./NetworkTileView";
// AFTER — unchanged path (both now siblings in features/network/)
import { NetworkTileView } from "./NetworkTileView";
```
(The `@/…` imports in both files resolve unchanged — the apps/web tsconfig `@/*` alias is visible to features, as proven by `features/guest-wifi/web.tsx`.) Re-export the view from `web.tsx` so the manifest imports both from one module:
```ts
export { NetworkTileView } from "./NetworkTileView";
```

- [ ] **Step 2: Create the manifest**

Create `features/network/manifest.ts` (coords verbatim from the registry entry):

```ts
import { defineApp } from "@app-kit";
import { NetworkTile, NetworkTileView } from "./web";

/**
 * The network app manifest (Track C, W0 — the second fold after guest-wifi).
 * defineApp is the single source of truth for the tile: id, board placement
 * (copied verbatim from the pre-fold tile-registry entry), and components. Not
 * guest-exposed. The codegen collects this and dedupes the id against the
 * registry so the feature is the tile's only source in the generated model.
 */
export default defineApp({
  id: "tile_wifi",
  tile: {
    label: "Network",
    component: NetworkTile,
    viewComponent: NetworkTileView,
    worldCol: 35,
    worldRow: 27,
    cols: 3,
    rows: 3,
  },
});
```

- [ ] **Step 3: Rewire the tile registry**

In `apps/web/src/lib/tile-registry.ts`:
1. Add the manifest import beside the guest-wifi one (line ~2):
```ts
import networkManifest from "@features/network/manifest";
```
2. Remove the two component imports (lines ~27-28):
```ts
import { NetworkTile } from "../components/tiles/NetworkTile";
import { NetworkTileView } from "../components/tiles/NetworkTileView";
```
3. Delete the `tile_wifi` object from `REGISTRY_ENTRIES` (the `{ id: "tile_wifi", label: "Network", component: NetworkTile, viewComponent: NetworkTileView, worldCol: 35, worldRow: 27, cols: 3, rows: 3 }` block).
4. Add the manifest to `FEATURE_MANIFESTS`:
```ts
const FEATURE_MANIFESTS: AppManifest[] = [guestWifiManifest, networkManifest];
```

- [ ] **Step 4: Move the frontend tests**

```bash
git mv apps/web/src/components/tiles/__tests__/NetworkTile.test.tsx features/network/web.test.tsx
git mv apps/web/src/components/tiles/__tests__/NetworkTileView.test.tsx features/network/web-view.test.tsx
git mv apps/web/src/components/tiles/NetworkTileView.stories.tsx features/network/NetworkTileView.stories.tsx
git mv apps/web/src/components/tiles/__tests__/NetworkTileView.stories.test.tsx features/network/web-view.stories.test.tsx
```
Repoint their imports of `../NetworkTile` / `../NetworkTileView` / `../../` to the new sibling paths (`./web`, `./NetworkTileView`). Grep each moved test for `NetworkTile` import lines and fix to `./web` (face) / `./NetworkTileView` (view). If a stories-test computes a path from the stories file location, update it to the new `features/network/` location.

- [ ] **Step 5: Regenerate + full frontend verify**

Run:
```bash
bun run apps:gen
bun run typecheck
bun vitest run features/network/web.test.tsx features/network/web-view.test.tsx features/network/web-view.stories.test.tsx
bun vitest run apps/web/src/**/placeholder-tiles*   # bento 1x1 clearance (memory bento-tiler-1x1-clearance)
bun run apps:check
```
Expected: `tiles.gen.ts` now lists `tile_wifi` with `source: "feature"` (was `"registry"`), appearing exactly once. Typecheck clean (no dangling `components/tiles/NetworkTile` import anywhere — grep to confirm). Moved tests pass. Placeholder-tiles test green (tile rect unchanged, so bento tiling is unaffected). `apps:check` green.

- [ ] **Step 6: Confirm the guest-wifi QR still resolves**

Grep `trpc.network.guestWifiQr` → still only `features/guest-wifi/web.tsx:48`. Confirm typecheck passed (the trpc client type now sources `network` from `featureAppRouter`), which proves the cross-feature call still type-resolves. No code change.

- [ ] **Step 7: Commit**

```bash
git pull --rebase --autostash
git add features/network/ apps/web/src/lib/tile-registry.ts features/_generated/
git commit -m "refactor(track-c): W0 fold network tile face + manifest into features/network"
git show --stat HEAD
git push
```

---

### Task 3: Whole-fold verification + panel confirm

**Files:** none (verification only).

- [ ] **Step 1: Full suite + boundary + drift**

Run:
```bash
bun run typecheck
bun run lint
bun run apps:check
bun vitest run features/network
```
Expected: all green. `lint` proves the dep boundary (no `features/network → apps/api`).

- [ ] **Step 2: Grep for orphans**

Run:
```bash
grep -rn "components/tiles/NetworkTile" apps features --include='*.ts' --include='*.tsx' | grep -v node_modules
grep -rn "services/network-service\|routers/network" apps features --include='*.ts' | grep -v node_modules
```
Expected: zero hits. If any, repoint or delete, then re-run Step 1.

- [ ] **Step 3: Wait for deploy green**

After push, watch CI to green (foreground, per memory `subagent-background-wait-stalls`):
```bash
gh run watch --exit-status
```
Then verify the deployed pods picked up the new image (memory `ci-cancelled-runs-strand-image-digests`): check pod image age is newer than the push.

- [ ] **Step 4: Panel visual confirm**

Open `app.worldwidewebb.co`, locate the Network tile at its board position, confirm it renders live (SSID, up/down GB, ping, butterfly traffic chart) — i.e. `trpc.network.status` resolves through the folded facet. Screenshot; self-critique before declaring done (memory `feedback-self-critique-ui-before-showing`).

---

## Self-Review

- **Spec coverage:** backend (service+api+config) → Task 1; frontend (tile+view+manifest+registry) → Task 2; verification + panel → Task 3. `guestWifiQr` continuity → Task 2 Step 6. Dep boundary → Task 1 Step 7 + Task 3 Step 1. All roadmap W0 bullets covered.
- **Placeholder scan:** every code step shows real content or an exact `git mv` + the precise import lines to change. No TBD/TODO.
- **Type consistency:** `NetworkConnectivity`, `getNetworkStatus`, `DEMO_NETWORK`, `buildWifiQrPayload`, `NetworkTile`, `NetworkTileView` used identically across service/api/web/tests. `api` facet key `network` matches the base-router key removed in Task 1 Step 4 and the trpc call sites (`trpc.network.status`, `trpc.network.guestWifiQr`).

## Out of scope / deferred

- Relocating `guestWifiQr` + `buildWifiQrPayload` into the guest-wifi feature (proper ownership). Deferred: it changes guest-wifi's router-key surface and touches `features/guest-wifi/web.tsx`. Tracked for a follow-up once both features are folded; the cross-feature call works via the generated router meanwhile.
- The `UnifiClient.getTrafficBuckets`/`getWanHealth` unit tests moved with `service.test.ts` really exercise `@www/core`; a later cleanup can relocate them to `packages/core` tests. Not W0.

## Next unit

Per the master roadmap `~/.claude/plans/merry-hugging-river.md`, the next unit is **P1.1 — hoist the Home Assistant client to `@www/core`** (unblocks 7 tiles). Its own JIT plan gets written when W0 is green.
