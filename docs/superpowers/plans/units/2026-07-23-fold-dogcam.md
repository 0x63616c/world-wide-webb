# Fold `tile_dogcam` into features/dogcam/ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the `tile_dogcam` tile (tRPC router + service + tile UI) into
`features/dogcam/`, following the proven `features/network` (Track C, W0) and
`features/guest-wifi` (Track C, C7) fold pattern. Leave the raw
`/media/camera-stream` HTTP route hand-wired in `apps/api/src/server.ts` —
the S3 http-route seam does not exist yet.

**Architecture:** `features/dogcam/` becomes a self-contained App: `manifest.ts`
(tile registration, ADR-0001) + `web.tsx` (container `DogCamTile` + presentational
`DogCamTileView`, both inlined) + `api.ts` (the `defineApi`-branded `camera`
tRPC router) + `service.ts` (`getCameraInfo` + `openCameraStream`, HA reached via
`@www/core`'s `createHomeAssistantClient`, never `apps/api`'s singleton) +
`config.ts` (this feature's own env slice: `HA_URL`, `HA_TOKEN`, `GO2RTC_URL`,
`CAMERA_STREAM_NAME`, `CAMERA_LABEL`). No `schema.ts` — the camera has no DB
table (network is the precedent for a table-less fold). No `jobs.ts` — no queue
job or interval cycle for this tile. `apps/api/src/server.ts` keeps its raw
`/media/camera-stream` route but imports `openCameraStream` from
`@features/dogcam/service` instead of the deleted `apps/api/src/services/camera-service.ts`.
`apps/web/src/lib/tile-registry.ts` drops the `tile_dogcam` registry entry and
adds `dogcamManifest` to `FEATURE_MANIFESTS`, mirroring `guestWifiManifest` /
`networkManifest`. The detail-page wiring
(`apps/web/src/components/tiles/detail/wiring/dogcam.tsx`) re-points its
`DogCamTileView` import to `@features/dogcam/web`. Storybook stories
(`DogCamTileView.stories.tsx`) stay under `apps/web/src/components/tiles/` and
re-point their component import the same way (see `NetworkTileView.stories.tsx`
precedent, which imports `NetworkTileView` from `@features/network/web`).

**Tech Stack:** TypeScript, tRPC (`@app-kit`/`@app-kit/server` authoring
surface), Zod, React, Vitest, Storybook (`@storybook/react-vite`), Biome,
`@www/core` (`createHomeAssistantClient`).

## Global Constraints

- Fixed wall panel, `1366x1024`, not responsive (AGENTS.md) — not touched by
  this fold, no layout change.
- Shared primitives live in `packages/platform`/`packages/core`; a folded
  feature must reach the tRPC runtime only through `@app-kit`/`@app-kit/server`
  and must never import `apps/api` (Biome `noRestrictedImports`, enforced,
  verified in the lint step below).
- `features/<id>/` existing + `manifest.ts` IS the registration (ADR-0001).
  Tile placement is registry coords declared in `manifest.ts`, collected by
  `bun run apps:gen` into checked-in `features/_generated/*.gen.ts`
  (ADR-0002) — never hand-edit `_generated/`.
- IDs default to `prefix_<id>` — the tile id `tile_dogcam` is unchanged.
- No fake or placeholder data.
- Backend code uses structured logging (`getLogger()` from `@www/logger`) —
  already used in `camera-service.ts`'s `openCameraStream`; preserve as-is.
- `git pull --rebase --autostash` before any push; stage EXPLICIT paths, never
  `git add -A`; `git show --stat HEAD` to confirm no peer dirt after commit; no
  backticks in the commit message.
- `bun build`/tsc reads tsconfig `paths` from CWD — `cd apps/api` before any
  `apps/api`-scoped build command.
- knip is zero-tolerance — no dead exports/imports left behind by the move.

---

## Source → destination map

| Source (delete after move) | Destination | Notes |
|---|---|---|
| `apps/api/src/trpc/routers/camera.ts` | `features/dogcam/api.ts` | Wrap in `defineApi(router({ camera: cameraRouter }))`; router key **stays `camera`** (matches `trpc.camera.info` call sites in web — do not rename to `dogcam`, precedent: `network` feature's router key is `network`, not tied to tile id `wifi`). |
| `apps/api/src/services/camera-service.ts` | `features/dogcam/service.ts` | Both `getCameraInfo` and `openCameraStream` move together (one cohesive service file, same precedent as `network/service.ts` owning the whole UniFi surface). HA access changes from importing `apps/api`'s `ha` singleton to building its own client via `@www/core`. |
| `apps/api/src/integrations/homeassistant` (env-wiring for `ha` singleton) | — (not moved) | Stays in `apps/api` for the tiles not yet folded (tesla is next, Wave 2). `features/dogcam/service.ts` builds its OWN HA client instance from `features/dogcam/config.ts`, per the network/UniFi precedent — never imports `apps/api/src/integrations/homeassistant`. |
| (new) | `features/dogcam/config.ts` | Env slice: `HA_URL`, `HA_TOKEN`, `GO2RTC_URL`, `CAMERA_STREAM_NAME`, `CAMERA_LABEL`. |
| `apps/web/src/components/tiles/DogCamTile.tsx` + `apps/web/src/components/tiles/DogCamTileView.tsx` | `features/dogcam/web.tsx` | INLINED into one file exporting both `DogCamTile` (container) and `DogCamTileView` (presentational) + `DogCamTileViewProps`/`DogCamTileStatus` types — gotcha (2), precedent `features/network/web.tsx`. |
| (new) | `features/dogcam/manifest.ts` | `defineApp` with `id: "tile_dogcam"`, coords copied VERBATIM from the registry entry (below), `guestExposed` omitted (not guest-exposed). |
| `apps/web/src/components/tiles/__tests__/DogCamTile.test.tsx` | `features/dogcam/web.test.tsx` | Container tests — mock `../../../lib/trpc` → `@/lib/trpc`, import `DogCamTile` from `./web` instead of `../DogCamTile`. |
| `apps/web/src/components/tiles/__tests__/DogCamTileView.test.tsx` | `features/dogcam/web-view.test.tsx` | Pure view tests — import `DogCamTileView`/`DogCamTileViewProps` from `./web` instead of `../DogCamTileView`. |
| `apps/api/src/__tests__/camera.test.ts` | `features/dogcam/service.test.ts` | Mock target changes from `../integrations/homeassistant` to `@www/core`'s `createHomeAssistantClient` (see Task 2 for the exact mock shape) — `HomeAssistantClient`/`ha` singleton no longer exists in this feature. |
| `apps/web/src/components/tiles/DogCamTileView.stories.tsx` | **stays** at `apps/web/src/components/tiles/DogCamTileView.stories.tsx` | Gotcha (3). Only its component import changes: `import { DogCamTileView } from "./DogCamTileView"` → `import { DogCamTileView } from "@features/dogcam/web"`. |
| `apps/web/src/components/tiles/__tests__/DogCamTileView.stories.test.tsx` | **stays** at `apps/web/src/components/tiles/__tests__/DogCamTileView.stories.test.tsx` | Unchanged — still imports `* as stories from "../DogCamTileView.stories"` (the stories file itself didn't move). |

Files deleted (nothing left behind, knip-clean):
- `apps/api/src/trpc/routers/camera.ts`
- `apps/api/src/services/camera-service.ts`
- `apps/api/src/__tests__/camera.test.ts`
- `apps/web/src/components/tiles/DogCamTile.tsx`
- `apps/web/src/components/tiles/DogCamTileView.tsx`
- `apps/web/src/components/tiles/__tests__/DogCamTile.test.tsx`
- `apps/web/src/components/tiles/__tests__/DogCamTileView.test.tsx`

## Registry entry to delete (verbatim coords)

From `apps/web/src/lib/tile-registry.ts` (current, lines ~138–147):

```ts
  {
    id: "tile_dogcam",
    label: "Living Room Cam",
    component: DogCamTile,
    viewComponent: DogCamTileView,
    worldCol: 38,
    worldRow: 27,
    cols: 4,
    rows: 3,
  },
```

- `id`: `tile_dogcam`
- `label`: `Living Room Cam`
- `worldCol`: 38, `worldRow`: 27, `cols`: 4, `rows`: 3
- `guestExposed`: **NO** — not in `features/guest-exposed.ts`'s
  `GUEST_EXPOSED` allowlist, and must NOT be added to it. `defineApp` in the
  new `manifest.ts` omits the `guestExposed` key entirely (falsy default,
  same as `features/network/manifest.ts`).
- `home`: not set (this is not the home tile).

No `GUEST_EXPOSED` allowlist edit needed (dogcam is not guest-exposed).

## Cross-feature / importer repoints (exhaustive — verified by grep, `.claude/worktrees/*` excluded as stale)

1. `apps/api/src/server.ts:16` — `import { openCameraStream } from "./services/camera-service";`
   → `import { openCameraStream } from "@features/dogcam/service";`
   The `/media/camera-stream` route body at `server.ts:143` (the raw HTTP
   handler calling `openCameraStream()`) is **UNCHANGED** — only the import
   path moves. This is the GUARD: do not touch the route registration itself.
2. `apps/api/src/trpc/routers/index.ts` — remove `import { cameraRouter } from "./camera";`
   and the `camera: cameraRouter,` line from `baseRouter`. The `camera` key
   reappears in the merged router via `featureAppRouter`
   (`features/_generated/router.gen.ts`, regenerated by `apps:gen`) — `trpc.camera.info`
   call sites in web code need no change.
3. `apps/web/src/lib/tile-registry.ts` — remove the `DogCamTile`/`DogCamTileView`
   imports (lines ~22–23), remove the `tile_dogcam` entry, add
   `import dogcamManifest from "@features/dogcam/manifest";` and append
   `dogcamManifest` to `FEATURE_MANIFESTS` (`[guestWifiManifest, networkManifest, dogcamManifest]`).
4. `apps/web/src/components/tiles/detail/wiring/dogcam.tsx` — `import { DogCamTileView } from "@/components/tiles/DogCamTileView";`
   → `import { DogCamTileView } from "@features/dogcam/web";`. Nothing else in
   this file changes (`trpc.camera.info` still resolves the same way; `tileId: "tile_dogcam"` unchanged).
5. `apps/web/src/components/tiles/DogCamTileView.stories.tsx` — `import { DogCamTileView } from "./DogCamTileView";`
   → `import { DogCamTileView } from "@features/dogcam/web";`.

No other importers found (`apps/worker`, other `features/*`, `packages/*` do
not reference dogcam/camera symbols — verified via repo-wide grep excluding
`.claude/worktrees/*`, which hold unrelated stale copies from old sessions and
are out of scope).

## Test wiring (vitest.config.ts) — NO EDITS NEEDED

Both `apps/api/vitest.config.ts` and `apps/web/vitest.config.ts` already use
generic globs that pick up any `features/**/{service,api}.test.ts` (api project)
and `features/**/web*.test.tsx` (web project) — this is how `features/network`'s
and `features/guest-wifi`'s tests already run. `features/dogcam/service.test.ts`,
`features/dogcam/web.test.tsx`, and `features/dogcam/web-view.test.tsx` are
picked up automatically once created with those exact filenames. Confirm this
in Task 5's verify step — do not add per-feature glob entries.

The Storybook-adjacent stories test
(`apps/web/src/components/tiles/__tests__/DogCamTileView.stories.test.tsx`)
stays put and needs no wiring change (same precedent as
`NetworkTileView.stories.test.tsx`).

---

## Task 1: `features/dogcam/config.ts` + `service.ts`

**Files:**
- Create: `features/dogcam/config.ts`
- Create: `features/dogcam/service.ts`

**Interfaces:**
- Produces: `config` (parsed env object with `HA_URL`, `HA_TOKEN`,
  `GO2RTC_URL`, `CAMERA_STREAM_NAME`, `CAMERA_LABEL`); `getCameraInfo(): Promise<CameraInfo | null>`;
  `openCameraStream(): Promise<Response | null>`; `CameraInfo` interface
  (`label`, `online`, `snapshotUrl`, `streamUrl`, `entityId`).

- [ ] **Step 1: Write `features/dogcam/config.ts`**

```ts
/**
 * The dogcam feature's own config slice (Track C, Wave 2). Reads the already-
 * hydrated process.env (apps/api's env.ts runs docker-secret hydration before
 * any feature is imported) and validates just the keys this feature needs.
 * Never reaches into apps/api's `env`. Safe defaults so importing the branded
 * facets during codegen never throws before real values are wired.
 */
import { z } from "zod";

export const config = z
  .object({
    HA_URL: z.string().default(""),
    HA_TOKEN: z.string().default(""),
    GO2RTC_URL: z.string().url().default("http://go2rtc:1984"),
    CAMERA_STREAM_NAME: z.string().default("bedroom_mjpeg"),
    CAMERA_LABEL: z.string().default("Living Room Cam"),
  })
  .parse(process.env);
```

- [ ] **Step 2: Write `features/dogcam/service.ts`**

```ts
import { createHomeAssistantClient, type HaEntity } from "@www/core";
import { getLogger } from "@www/logger";
import { config } from "./config";

// Module-level singleton built from this feature's own config slice (mirrors
// features/network's createUnifiClient precedent) — never apps/api's `ha`.
const ha = createHomeAssistantClient({ baseUrl: config.HA_URL, token: config.HA_TOKEN });

export interface CameraInfo {
  label: string;
  online: boolean;
  snapshotUrl: string | null;
  /** Path to the api's MJPEG proxy route, served from the same origin as the panel. */
  streamUrl: string | null;
  entityId: string | null;
}

/** The api route that proxies go2rtc's MJPEG stream (see apps/api/src/server.ts). */
const STREAM_ROUTE = "/media/camera-stream";

/**
 * Describes the camera tile's stream.
 *
 * The camera is driven by go2rtc, which pulls RTSP straight off the camera on
 * the LAN. That deliberately does NOT depend on Home Assistant: HA has proven
 * flaky and blanking the tile every time it falls over is unacceptable. So the
 * populated CameraInfo below is produced unconditionally from go2rtc config.
 *
 * Home Assistant is OPTIONAL ENRICHMENT only, if it happens to answer with a
 * camera entity we borrow its friendly_name and entity_id. If HA is
 * unconfigured, unreachable, or throws, we swallow it and return the go2rtc
 * view. HA can never blank the tile and can never mark it offline.
 */
export async function getCameraInfo(): Promise<CameraInfo | null> {
  const info: CameraInfo = {
    label: config.CAMERA_LABEL,
    online: true,
    // The camera exposes no still endpoint we proxy today; the live MJPEG
    // stream is the tile's only surface.
    snapshotUrl: null,
    streamUrl: STREAM_ROUTE,
    entityId: null,
  };

  const entity = await findHaCameraEntity();
  if (!entity) return info;

  const friendlyName = entity.attributes.friendly_name as string | undefined;
  return {
    ...info,
    label: friendlyName ?? info.label,
    entityId: entity.entity_id,
  };
}

/**
 * Best-effort lookup of a camera entity in HA. Never throws, any HA failure
 * resolves to null and the caller falls back to the go2rtc-only view.
 */
async function findHaCameraEntity(): Promise<HaEntity | null> {
  if (!ha.isConfigured()) return null;

  try {
    const entities = await ha.getEntities("camera");
    if (entities.length === 0) return null;

    const preferred = entities.find((e) => {
      const id = e.entity_id.toLowerCase();
      const name = String(e.attributes.friendly_name ?? "").toLowerCase();
      return (
        id.includes("bedroom") ||
        id.includes("living") ||
        id.includes("dog") ||
        name.includes("bedroom") ||
        name.includes("living") ||
        name.includes("dog")
      );
    });

    return preferred ?? entities[0];
  } catch {
    // HA down/misconfigured, the tile does not need it. Stay silent at info
    // level; the go2rtc stream is the source of truth.
    return null;
  }
}

/**
 * Opens the live MJPEG stream from go2rtc and hands the upstream Response back
 * so apps/api/src/server.ts's raw /media/camera-stream route can pipe its body
 * straight through to the panel.
 *
 * NO AbortSignal / timeout is attached anywhere on this path: an MJPEG
 * multipart response is a long-lived connection that never "completes", so any
 * timeout would kill the live feed mid-flight.
 *
 * Returns null on a non-ok upstream or a transport error. Never logs the RTSP
 * URL or camera credentials, those live only inside go2rtc's own config.
 */
export async function openCameraStream(): Promise<Response | null> {
  const url = `${config.GO2RTC_URL}/api/stream.mjpeg?src=${encodeURIComponent(config.CAMERA_STREAM_NAME)}`;
  const startedAt = performance.now();

  try {
    const res = await fetch(url);
    const durationMs = +(performance.now() - startedAt).toFixed(1);

    if (!res.ok) {
      getLogger().warn({ status: res.status, durationMs }, "go2rtc stream request failed");
      return null;
    }
    return res;
  } catch (err) {
    const durationMs = +(performance.now() - startedAt).toFixed(1);
    getLogger().warn({ err, durationMs }, "go2rtc unreachable");
    return null;
  }
}
```

Confirm `HaEntity` is exported from `@www/core` (it is — re-exported today via
`apps/api/src/integrations/homeassistant/types.ts`'s
`export type { HaEntity } from "@www/core";`). If the named export differs,
match whatever `@www/core`'s public surface actually exports for the entity
shape used by `entities.find(...)`.

- [ ] **Step 3: Move + adapt the service test to `features/dogcam/service.test.ts`**

Move `apps/api/src/__tests__/camera.test.ts` content, changing the mock target
from `../integrations/homeassistant` (the apps/api singleton) to `@www/core`'s
`createHomeAssistantClient` factory, and the import of `getCameraInfo` from
`../services/camera-service` to `./service`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @www/core's HA client factory before any imports that pull in ./service
// (which builds its own client from createHomeAssistantClient at module scope).
const mockHa = {
  isConfigured: vi.fn(() => false),
  getEntities: vi.fn(async () => []),
};
vi.mock("@www/core", async () => {
  const actual = await vi.importActual<typeof import("@www/core")>("@www/core");
  return { ...actual, createHomeAssistantClient: vi.fn(() => mockHa) };
});

import { config } from "../config";
import { getCameraInfo } from "../service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCameraInfo", () => {
  // The tile is driven by go2rtc (direct RTSP), NOT Home Assistant. HA has
  // crashed repeatedly in production, so an HA outage must never blank it.
  it("still populates the tile when HA is not configured", async () => {
    mockHa.isConfigured.mockReturnValue(false);

    const result = await getCameraInfo();

    expect(result).not.toBeNull();
    expect(result?.label).toBe(config.CAMERA_LABEL);
    expect(result?.online).toBe(true);
    expect(result?.streamUrl).toBe("/media/camera-stream");
    expect(result?.entityId).toBeNull();
    expect(result?.snapshotUrl).toBeNull();
    expect(mockHa.getEntities).not.toHaveBeenCalled();
  });

  it("still populates the tile when HA is unreachable (getEntities throws)", async () => {
    mockHa.isConfigured.mockReturnValue(true);
    mockHa.getEntities.mockRejectedValue(new Error("network error"));

    const result = await getCameraInfo();

    expect(result).not.toBeNull();
    expect(result?.label).toBe(config.CAMERA_LABEL);
    expect(result?.online).toBe(true);
    expect(result?.streamUrl).toBe("/media/camera-stream");
    expect(result?.entityId).toBeNull();
  });

  it("still populates the tile when HA has no camera entities", async () => {
    mockHa.isConfigured.mockReturnValue(true);
    mockHa.getEntities.mockResolvedValue([]);

    const result = await getCameraInfo();

    expect(result?.streamUrl).toBe("/media/camera-stream");
    expect(result?.online).toBe(true);
    expect(result?.entityId).toBeNull();
  });

  it("enriches label + entityId from a preferred HA entity", async () => {
    mockHa.isConfigured.mockReturnValue(true);
    mockHa.getEntities.mockResolvedValue([
      {
        entity_id: "camera.front_door",
        state: "idle",
        attributes: { friendly_name: "Front Door" },
        last_updated: "2024-01-01T00:00:00Z",
      },
      {
        entity_id: "camera.bedroom_cam",
        state: "streaming",
        attributes: { friendly_name: "Living Room Cam" },
        last_updated: "2024-01-01T00:00:00Z",
      },
    ]);

    const result = await getCameraInfo();

    expect(result?.entityId).toBe("camera.bedroom_cam");
    expect(result?.label).toBe("Living Room Cam");
    expect(result?.online).toBe(true);
    expect(result?.snapshotUrl).toBeNull();
    expect(result?.streamUrl).toBe("/media/camera-stream");
  });

  it("prefers entity containing 'dog' in friendly_name", async () => {
    mockHa.isConfigured.mockReturnValue(true);
    mockHa.getEntities.mockResolvedValue([
      {
        entity_id: "camera.generic_cam_1",
        state: "idle",
        attributes: { friendly_name: "Generic Cam" },
        last_updated: "2024-01-01T00:00:00Z",
      },
      {
        entity_id: "camera.generic_cam_2",
        state: "idle",
        attributes: { friendly_name: "Dog Camera" },
        last_updated: "2024-01-01T00:00:00Z",
      },
    ]);

    const result = await getCameraInfo();

    expect(result?.entityId).toBe("camera.generic_cam_2");
    expect(result?.label).toBe("Dog Camera");
  });

  it("falls back to first entity when no preferred entity matches", async () => {
    mockHa.isConfigured.mockReturnValue(true);
    mockHa.getEntities.mockResolvedValue([
      {
        entity_id: "camera.front_door",
        state: "idle",
        attributes: { friendly_name: "Front Door" },
        last_updated: "2024-01-01T00:00:00Z",
      },
    ]);

    const result = await getCameraInfo();

    expect(result?.entityId).toBe("camera.front_door");
    expect(result?.label).toBe("Front Door");
    expect(result?.online).toBe(true);
  });

  it("stays online even when the HA entity reports 'unavailable'", async () => {
    // go2rtc, not HA, owns liveness. An HA entity going unavailable (a common
    // symptom of HA itself being sick) must not black out a working stream.
    mockHa.isConfigured.mockReturnValue(true);
    mockHa.getEntities.mockResolvedValue([
      {
        entity_id: "camera.bedroom",
        state: "unavailable",
        attributes: { friendly_name: "Bedroom" },
        last_updated: "2024-01-01T00:00:00Z",
      },
    ]);

    const result = await getCameraInfo();

    expect(result?.online).toBe(true);
    expect(result?.entityId).toBe("camera.bedroom");
    expect(result?.streamUrl).toBe("/media/camera-stream");
  });

  it("keeps the configured label when friendly_name is absent", async () => {
    mockHa.isConfigured.mockReturnValue(true);
    mockHa.getEntities.mockResolvedValue([
      {
        entity_id: "camera.bedroom",
        state: "idle",
        attributes: {},
        last_updated: "2024-01-01T00:00:00Z",
      },
    ]);

    const result = await getCameraInfo();

    expect(result?.label).toBe(config.CAMERA_LABEL);
    expect(result?.entityId).toBe("camera.bedroom");
  });
});
```

PLACEHOLDER: verify `@www/core`'s actual export surface supports
`vi.importActual` cleanly and that `createHomeAssistantClient` is indeed the
factory name (confirmed via `apps/api/src/integrations/homeassistant/index.ts`
today: `import { createHomeAssistantClient } from "@www/core";`). If `@www/core`
re-exports things that don't tree-shake well under `importActual` in Vitest,
fall back to mocking the whole `@www/core` module surface explicitly (list every
export the file re-uses) rather than spreading `actual`.

Do NOT commit yet — this is folded into the atomic Task 4 commit (gotcha 1: a
partial commit without `manifest.ts` breaks codegen collection). Stage only,
or work directly and commit once at the end of Task 4.

---

## Task 2: `features/dogcam/web.tsx` (inlined tile + view) + its tests

**Files:**
- Create: `features/dogcam/web.tsx`
- Create: `features/dogcam/web.test.tsx`
- Create: `features/dogcam/web-view.test.tsx`

**Interfaces:**
- Consumes: nothing from Task 1 directly (the container calls `trpc.camera.info.useQuery`,
  which resolves through the merged router once Task 3's `api.ts` + Task 4's
  `manifest.ts` land — codegen wires it, not a direct import).
- Produces: `DogCamTile` (container, no props), `DogCamTileView` (presentational,
  props `DogCamTileViewProps`), `DogCamTileStatus` type alias — consumed by
  `manifest.ts` (Task 4), by `apps/web/src/components/tiles/detail/wiring/dogcam.tsx`,
  and by `apps/web/src/components/tiles/DogCamTileView.stories.tsx`.

- [ ] **Step 1: Write `features/dogcam/web.tsx`**

```tsx
import { Icon } from "@/components/Icon";
import { Skeleton, Tile, TileHeader, TileStatus } from "@/components/ui";
import { POLL } from "@/lib/hooks";
import { openTileDetail } from "@/lib/tile-detail-store";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";

/** Format elapsed seconds as HH:MM:SS */
function formatRec(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

export type DogCamTileStatus = TileStatus;

export interface DogCamTileViewProps {
  status: DogCamTileStatus;
  label?: string | null;
  online?: boolean;
  snapshotUrl?: string | null;
  /**
   * MJPEG stream URL (the api's /media/camera-stream proxy in front of go2rtc).
   * A multipart/x-mixed-replace response renders natively in an <img>, which is
   * why MJPEG was chosen, an <img> cannot send auth headers, so the old HA
   * camera_proxy approach was unusable.
   */
  streamUrl?: string | null;
  /** Whether the live feed overlay is currently visible, local presentation state owned by the container */
  live: boolean;
  /** Elapsed recording seconds, driven by the container's interval */
  recSecs: number;
  onToggleLive: () => void;
}

export function DogCamTileView({
  status,
  label,
  online,
  snapshotUrl,
  streamUrl,
  live,
  recSecs,
  onToggleLive,
}: DogCamTileViewProps) {
  // Error is treated the same as loading, shimmer cover, keep retrying via QueryClient
  const isLoading = status === TileStatus.Loading || status === TileStatus.Error;

  return (
    <Tile padding={22}>
      {/* Title MUST stay in sync with the manifest label in features/dogcam/manifest.ts, the minimap and pan labels read it. */}
      <TileHeader icon="cam" title="Living Room Cam" />
      {/* Feed shell, fills remaining space */}
      <button
        type="button"
        className="feed"
        style={{
          flex: 1,
          minHeight: 0,
          cursor: "pointer",
          padding: 0,
          textAlign: "inherit",
          font: "inherit",
          color: "inherit",
        }}
        onClick={onToggleLive}
        aria-label={live ? "Hide camera feed" : "View camera feed"}
      >
        {/* Dog ghost icon, z-index 0, always behind content */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            pointerEvents: "none",
            zIndex: 0,
            color: "var(--ink-3)",
            opacity: 0.55,
          }}
        >
          <Icon name="dog" s={58} c="currentColor" sw={1.3} />
        </div>

        {/* Snapshot / placeholder area, z-index 1 */}
        {snapshotUrl ? (
          <img
            src={snapshotUrl}
            alt={label ?? ""}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              zIndex: 1,
            }}
          />
        ) : (
          // Dark gradient background when no snapshot is available
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "var(--tile)",
              zIndex: 1,
            }}
          />
        )}

        {/*
          Live MJPEG stream, z-index 2, above the snapshot poster.
          Mounted ONLY while live: the browser holds the multipart connection open
          for as long as this <img> exists, so keeping it mounted under the frosted
          cover would pin an open stream to go2rtc forever. Unmounting on !live
          tears the connection down.
        */}
        {live && streamUrl ? (
          <img
            src={streamUrl}
            alt={label ?? "Live camera feed"}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              zIndex: 2,
            }}
          />
        ) : null}

        {/* Scanline overlay, z-index 3 */}
        <div className="scan" />

        {/* Live state: LIVE dot, REC timer, caption */}
        {live ? (
          <>
            <div
              style={{
                position: "absolute",
                top: 12,
                left: 13,
                display: "flex",
                alignItems: "center",
                gap: 8,
                zIndex: 4,
              }}
            >
              <span className="dot" />
              <span
                className="mono"
                style={{
                  fontSize: 12,
                  color: "var(--acc)",
                  letterSpacing: ".12em",
                  textShadow: "0 1px 4px #000",
                }}
              >
                LIVE
              </span>
            </div>
            <div
              style={{ position: "absolute", top: 12, right: 13, zIndex: 4 }}
              className="mono cap"
            >
              REC {formatRec(recSecs)}
            </div>
            <div
              style={{
                position: "absolute",
                bottom: 12,
                left: 13,
                zIndex: 4,
                textShadow: "0 1px 4px #000",
              }}
              className="cap"
            >
              {label ?? <Skeleton w={80} h={12} />}
            </div>
          </>
        ) : (
          /* Covered state: frosted-glass overlay */
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 5,
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              background: "rgba(18,22,26,.42)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 9,
            }}
          >
            {isLoading || !label ? (
              <Icon name="cam" s={30} c="var(--ink-3)" />
            ) : (
              <>
                <Icon name="cam" s={30} c="var(--ink-2)" />
                <div style={{ fontSize: 16, fontWeight: 500 }}>
                  {label ?? <Skeleton w={100} h={16} />}
                </div>
                <div className="cap">
                  {online === false ? "Camera offline" : "Tap to view feed"}
                </div>
              </>
            )}
          </div>
        )}
      </button>
    </Tile>
  );
}

/**
 * Thin container for the Living Room Cam tile face. The face stays covered
 * (frosted snapshot poster), tapping the feed opens the full-page detail via
 * the tile-detail registry (apps/web/src/components/tiles/detail/wiring/dogcam.tsx),
 * which owns the live/REC toggle the face used to run inline.
 */
export function DogCamTile() {
  const { status, data } = useTileQuery(
    trpc.camera.info.useQuery(undefined, {
      refetchInterval: POLL.dogcam,
      retry: 2,
    }),
  );

  return (
    <DogCamTileView
      status={status}
      label={data?.label ?? null}
      online={data?.online ?? false}
      snapshotUrl={data?.snapshotUrl ?? null}
      streamUrl={data?.streamUrl ?? null}
      live={false}
      recSecs={0}
      onToggleLive={() => openTileDetail("tile_dogcam")}
    />
  );
}
```

- [ ] **Step 2: Write `features/dogcam/web-view.test.tsx`** (moved from
      `apps/web/src/components/tiles/__tests__/DogCamTileView.test.tsx`,
      import source changed from `../DogCamTileView` to `./web`)

Read the current file at
`apps/web/src/components/tiles/__tests__/DogCamTileView.test.tsx` in full and
copy it verbatim except the two import lines:

```ts
import type { DogCamTileViewProps } from "./web";
import { DogCamTileView } from "./web";
```

(replacing `import type { DogCamTileViewProps } from "../DogCamTileView";` and
`import { DogCamTileView } from "../DogCamTileView";`). All other content,
including `import "@testing-library/jest-dom";`, `cleanup`/`fireEvent`/`render`/`screen`,
and every `describe`/`it` block, is unchanged.

- [ ] **Step 3: Write `features/dogcam/web.test.tsx`** (moved from
      `apps/web/src/components/tiles/__tests__/DogCamTile.test.tsx`, mock path
      + import source changed)

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the trpc module so no real HTTP is made in tests.
// We expose a replaceable spy for camera.info.useQuery.
const mockUseQuery = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    camera: {
      info: {
        useQuery: (...args: unknown[]) => mockUseQuery(...args),
      },
    },
  },
}));

// The face opens the full-page detail via the tile-detail store, spy on it.
const mockOpenTileDetail = vi.fn();
vi.mock("@/lib/tile-detail-store", () => ({
  openTileDetail: (...args: unknown[]) => mockOpenTileDetail(...args),
}));

// Import AFTER the mocks are registered.
import { DogCamTile } from "./web";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Helpers
function renderWithData(overrides?: {
  data?: Partial<{
    label: string;
    online: boolean;
    snapshotUrl: string | null;
    streamUrl: string | null;
    entityId: string | null;
  }>;
  isLoading?: boolean;
  isError?: boolean;
}) {
  const defaults = {
    label: "Living Room",
    online: true,
    snapshotUrl: null,
    streamUrl: null,
    entityId: "camera.living_room",
  };
  mockUseQuery.mockReturnValue({
    data: overrides?.data !== undefined ? { ...defaults, ...overrides.data } : defaults,
    isLoading: overrides?.isLoading ?? false,
    isError: overrides?.isError ?? false,
  });
  return render(<DogCamTile />);
}

describe("DogCamTile", () => {
  describe("section header", () => {
    it("renders the 'Living Room Cam' section header", () => {
      renderWithData();
      expect(screen.getByText("Living Room Cam")).toBeDefined();
    });

    it("tile wrapper has padding 22", () => {
      const { container } = renderWithData();
      const tile = container.firstChild as HTMLElement;
      expect(tile.style.padding).toBe("22px");
    });
  });

  describe("covered state (always, on the face)", () => {
    it("renders the frosted cover with cam icon, label, and tap prompt", () => {
      renderWithData();
      expect(screen.getByText("Living Room")).toBeDefined();
      expect(screen.getByText(/tap to view feed/i)).toBeDefined();
    });

    it("uses data label from camera.info", () => {
      renderWithData({ data: { label: "Backyard Cam" } });
      expect(screen.getByText("Backyard Cam")).toBeDefined();
    });

    it("renders skeleton (no label text) when data is undefined", () => {
      mockUseQuery.mockReturnValue({ data: undefined, isLoading: false, isError: false });
      render(<DogCamTile />);
      // No hardcoded label should appear; skeleton placeholder is rendered instead
      expect(screen.queryByText("Living Room")).toBeNull();
    });

    it("shows 'Camera offline' when camera is not online", () => {
      renderWithData({ data: { online: false } });
      expect(screen.getByText(/camera offline/i)).toBeDefined();
    });

    it("never renders LIVE/REC on the face, the live feed lives on the detail page", () => {
      renderWithData({ data: { streamUrl: "/media/camera-stream" } });
      expect(screen.queryByText("LIVE")).toBeNull();
      expect(screen.queryByText(/^REC /)).toBeNull();
    });
  });

  describe("loading state", () => {
    it("renders loading cover without label text when isLoading", () => {
      mockUseQuery.mockReturnValue({ data: undefined, isLoading: true, isError: false });
      render(<DogCamTile />);
      const feedEl = screen.getByRole("button");
      expect(feedEl).toBeDefined();
    });
  });

  describe("snapshot image", () => {
    it("renders img with snapshotUrl when provided", () => {
      renderWithData({ data: { snapshotUrl: "http://ha.local/cam.jpg" } });
      const img = screen.getByRole("img");
      expect((img as HTMLImageElement).src).toContain("cam.jpg");
    });

    it("renders no img when snapshotUrl is null", () => {
      renderWithData({ data: { snapshotUrl: null } });
      expect(screen.queryByRole("img")).toBeNull();
    });
  });

  describe("tap surface", () => {
    it("tapping the feed opens the full-page detail instead of toggling inline", () => {
      renderWithData({ data: { streamUrl: "/media/camera-stream" } });

      fireEvent.click(screen.getByRole("button"));

      expect(mockOpenTileDetail).toHaveBeenCalledWith("tile_dogcam");
      // The face stays covered, no inline stream, no LIVE chrome.
      expect(screen.queryByText("LIVE")).toBeNull();
      expect(screen.getByText(/tap to view feed/i)).toBeDefined();
    });
  });
});
```

PLACEHOLDER: confirm `@/lib/trpc` and `@/lib/tile-detail-store` resolve inside
`features/dogcam/` under `apps/web/vitest.config.ts`'s `@` alias (it points at
`apps/web/src`, and `features/network/web.test.tsx` already mocks `@/lib/trpc`
the same way — precedent confirms this resolves).

Do not commit yet (folds into Task 4's atomic commit).

---

## Task 3: `features/dogcam/api.ts`

**Files:**
- Create: `features/dogcam/api.ts`

**Interfaces:**
- Consumes: `getCameraInfo` from `./service` (Task 1).
- Produces: `api` (the branded `defineApi` export, single top-level key
  `camera`) — collected by `bun run apps:gen` into `features/_generated/router.gen.ts`.

- [ ] **Step 1: Write `features/dogcam/api.ts`**

```ts
/**
 * tRPC `camera` facet (Track C, Wave 2). The Living Room Cam tile's info
 * surface. Reaches the tRPC runtime ONLY through @app-kit/server and HA ONLY
 * through the feature's own service — never apps/api. Codegen collects the
 * top-level key `camera` off `api._def.record`.
 */
import { defineApi } from "@app-kit";
import { publicProcedure, router } from "@app-kit/server";
import { z } from "zod";
import { getCameraInfo } from "./service";

const CameraInfoSchema = z
  .object({
    label: z.string(),
    online: z.boolean(),
    snapshotUrl: z.string().nullable(),
    streamUrl: z.string().nullable(),
    entityId: z.string().nullable(),
  })
  .nullable();

const cameraRouter = router({
  info: publicProcedure
    .input(z.object({}).optional())
    .output(CameraInfoSchema)
    .query(() => getCameraInfo()),
});

/** The branded `api` facet, single top-level key `camera`. */
export const api = defineApi(router({ camera: cameraRouter }));
```

Do not commit yet (folds into Task 4's atomic commit).

---

## Task 4: `manifest.ts` + registry/importer repoints + atomic commit

**Files:**
- Create: `features/dogcam/manifest.ts`
- Modify: `apps/web/src/lib/tile-registry.ts`
- Modify: `apps/web/src/components/tiles/detail/wiring/dogcam.tsx`
- Modify: `apps/web/src/components/tiles/DogCamTileView.stories.tsx`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/trpc/routers/index.ts`
- Delete: `apps/api/src/trpc/routers/camera.ts`
- Delete: `apps/api/src/services/camera-service.ts`
- Delete: `apps/api/src/__tests__/camera.test.ts`
- Delete: `apps/web/src/components/tiles/DogCamTile.tsx`
- Delete: `apps/web/src/components/tiles/DogCamTileView.tsx`
- Delete: `apps/web/src/components/tiles/__tests__/DogCamTile.test.tsx`
- Delete: `apps/web/src/components/tiles/__tests__/DogCamTileView.test.tsx`

**Interfaces:**
- Consumes: `DogCamTile`/`DogCamTileView` from `./web` (Task 2); `api` from `./api` (Task 3, consumed indirectly by codegen, not imported here).
- Produces: `dogcamManifest` default export — consumed by `apps/web/src/lib/tile-registry.ts`'s `FEATURE_MANIFESTS` and by `bun run apps:gen`'s glob collection.

- [ ] **Step 1: Write `features/dogcam/manifest.ts`**

```ts
import { defineApp } from "@app-kit";
import { DogCamTile, DogCamTileView } from "./web";

/**
 * The dogcam app manifest (Track C, Wave 2). defineApp is the single source of
 * truth for the tile: id, board placement (copied verbatim from the pre-fold
 * tile-registry entry), and components. Not guest-exposed. The camera-stream
 * raw HTTP route (/media/camera-stream, apps/api/src/server.ts) stays
 * hand-wired until the S3 http-route seam lands — this fold covers only the
 * tile + tRPC api + service, per the master execution plan's Wave 2 note.
 */
export default defineApp({
  id: "tile_dogcam",
  tile: {
    label: "Living Room Cam",
    component: DogCamTile,
    viewComponent: DogCamTileView,
    worldCol: 38,
    worldRow: 27,
    cols: 4,
    rows: 3,
  },
});
```

- [ ] **Step 2: Edit `apps/web/src/lib/tile-registry.ts`**

Remove these two import lines:

```ts
import { DogCamTile } from "../components/tiles/DogCamTile";
import { DogCamTileView } from "../components/tiles/DogCamTileView";
```

Add, alongside the other feature-manifest imports at the top of the file:

```ts
import dogcamManifest from "@features/dogcam/manifest";
```

Remove the `tile_dogcam` object from the hand-placed registry array (the block
shown in "Registry entry to delete" above).

Change:

```ts
const FEATURE_MANIFESTS: AppManifest[] = [guestWifiManifest, networkManifest];
```

to:

```ts
const FEATURE_MANIFESTS: AppManifest[] = [guestWifiManifest, networkManifest, dogcamManifest];
```

- [ ] **Step 3: Edit `apps/web/src/components/tiles/detail/wiring/dogcam.tsx`**

Change:

```ts
import { DogCamTileView } from "@/components/tiles/DogCamTileView";
```

to:

```ts
import { DogCamTileView } from "@features/dogcam/web";
```

No other line in this file changes.

- [ ] **Step 4: Edit `apps/web/src/components/tiles/DogCamTileView.stories.tsx`**

Change:

```ts
import { DogCamTileView } from "./DogCamTileView";
```

to:

```ts
import { DogCamTileView } from "@features/dogcam/web";
```

No other line in this file changes.

- [ ] **Step 5: Edit `apps/api/src/server.ts`**

Change:

```ts
import { openCameraStream } from "./services/camera-service";
```

to:

```ts
import { openCameraStream } from "@features/dogcam/service";
```

The `/media/camera-stream` route body at `server.ts:143` (`if (url.pathname === "/media/camera-stream") { const upstream = await openCameraStream(); ... }`)
is otherwise UNCHANGED — this is the GUARD. Do not migrate the route itself.

- [ ] **Step 6: Edit `apps/api/src/trpc/routers/index.ts`**

Remove:

```ts
import { cameraRouter } from "./camera";
```

Remove `camera: cameraRouter,` from the `baseRouter` object.

- [ ] **Step 7: Delete the superseded source files**

```bash
git rm apps/api/src/trpc/routers/camera.ts
git rm apps/api/src/services/camera-service.ts
git rm apps/api/src/__tests__/camera.test.ts
git rm apps/web/src/components/tiles/DogCamTile.tsx
git rm apps/web/src/components/tiles/DogCamTileView.tsx
git rm apps/web/src/components/tiles/__tests__/DogCamTile.test.tsx
git rm apps/web/src/components/tiles/__tests__/DogCamTileView.test.tsx
```

- [ ] **Step 8: Regenerate codegen**

```bash
bun run apps:gen
```

Expected: `features/_generated/router.gen.ts`, `features/_generated/tiles.gen.ts`,
`features/_generated/schema.gen.ts`, `features/_generated/guest-router.gen.ts`,
`features/_generated/crons.gen.ts` are rewritten; `tiles.gen.ts`'s `tile_dogcam`
entry now has `source: "feature"` instead of `source: "registry"` (same
transition `tile_wifi` and `tile_guestwifi` already made). Stage the
regenerated files.

- [ ] **Step 9: Typecheck**

```bash
bun run typecheck
```

Expected: PASS. Fix-forward on any red (most likely a stray import of the
deleted `DogCamTile`/`DogCamTileView`/`camera-service` symbols — re-grep for
`DogCamTile\b` and `camera-service` across the repo, excluding `.claude/worktrees/*`,
and repoint anything found).

- [ ] **Step 10: Run the moved/colocated tests**

```bash
cd apps/api && bunx vitest run ../../features/dogcam/service.test.ts
cd apps/web && bunx vitest run ../../features/dogcam/web.test.tsx ../../features/dogcam/web-view.test.tsx src/components/tiles/__tests__/DogCamTileView.stories.test.tsx
```

Expected: all PASS. Also run the bento 1x1 clearance suite (a moved tile must
not break gap-free tiling, memory `bento-tiler-1x1-clearance`):

```bash
cd apps/web && bunx vitest run -t "placeholder-tiles"
```

If that `-t` filter matches nothing, locate the actual placeholder-tiles test
file (`grep -rl "placeholder-tiles\|placeholder tiles" apps/web/src --include=*.test.*`)
and run it by path instead. Expected: PASS (tile coords are unchanged —
verbatim copy — so no new gap should appear).

- [ ] **Step 11: `apps:check` (codegen drift + validator)**

```bash
bun run apps:check
```

Expected: PASS — confirms no codegen drift between the committed
`features/_generated/*.gen.ts` and a fresh render, and that the validator sees
no dup id/router-key/table, exactly one `home` tile, no overlapping tile rects,
and `guestExposed` agrees with `GUEST_EXPOSED` for `tile_dogcam` (false/absent
on both sides).

- [ ] **Step 12: knip (zero-tolerance)**

```bash
bun run knip
```

Expected: PASS, no dead exports (the old `DogCamTile.tsx`/`DogCamTileView.tsx`/`camera-service.ts`/`routers/camera.ts` files are gone, not flagged as unused).

- [ ] **Step 13: lint (proves the features/*→apps/api Biome boundary stays green)**

```bash
bun run lint
```

Expected: PASS — confirms `features/dogcam/service.ts` and `features/dogcam/api.ts`
do not import `apps/api` (they reach HA via `@www/core` and the tRPC runtime
via `@app-kit`/`@app-kit/server`, per the `noRestrictedImports` rule).

- [ ] **Step 14: Stage explicit paths, verify no peer dirt, commit**

```bash
git pull --rebase --autostash
git status
```

Confirm the working tree contains only this fold's changes (no unrelated dirty
files from a parallel session — if there are, do NOT sweep them into this
commit).

```bash
git add features/dogcam/config.ts features/dogcam/service.ts features/dogcam/service.test.ts \
  features/dogcam/web.tsx features/dogcam/web.test.tsx features/dogcam/web-view.test.tsx \
  features/dogcam/api.ts features/dogcam/manifest.ts \
  features/_generated/router.gen.ts features/_generated/tiles.gen.ts \
  features/_generated/schema.gen.ts features/_generated/guest-router.gen.ts \
  features/_generated/crons.gen.ts \
  apps/web/src/lib/tile-registry.ts \
  apps/web/src/components/tiles/detail/wiring/dogcam.tsx \
  apps/web/src/components/tiles/DogCamTileView.stories.tsx \
  apps/api/src/server.ts apps/api/src/trpc/routers/index.ts
git status
```

(The `git rm` deletions from Step 7 are already staged.) Confirm `git status`
shows exactly this file set staged, nothing else.

```bash
git commit -m "feat(features): fold dogcam tile into features/dogcam (Track C)"
```

```bash
git show --stat HEAD
```

Confirm the stat output matches the intended file set — no peer-session dirt
swept in.

- [ ] **Step 15: Push**

```bash
git push
```

Push immediately (AGENTS.md workflow rule — push to main deploys to prod, no
batching).

---

## Self-Review

**Spec coverage:**
- Tile → `features/dogcam/web.tsx` (Task 2) — done.
- Router → `features/dogcam/api.ts` (Task 3) — done, router key `camera` preserved.
- Service → `features/dogcam/service.ts` (Task 1), HA via `@www/core` — done.
- Schema → N/A, no table (documented; same as `network`).
- `manifest.ts` coords verbatim from registry (Task 4, Step 1) — `worldCol: 38, worldRow: 27, cols: 4, rows: 3` copied exactly.
- Registry entry deleted (Task 4, Step 2) — done; not guest-exposed, no allowlist edit.
- Every importer repointed (Task 4, Steps 3–6) — `server.ts`, `routers/index.ts`, `tile-registry.ts`, `detail/wiring/dogcam.tsx`, `DogCamTileView.stories.tsx` — all five identified importers covered.
- camera-stream raw route stays hand-wired in `server.ts` — GUARD honored explicitly in Task 4 Step 5 and in the manifest.ts docstring.
- Tests moved + wired: `service.test.ts`/`web.test.tsx`/`web-view.test.tsx` land where the existing generic vitest globs already pick them up (verified, no config edit needed); stories + stories test stay in `apps/web/src/components/tiles/`.
- Full verify chain — Task 4 Steps 8–13 run `apps:gen`, `typecheck`, colocated tests + placeholder-tiles, `apps:check`, `knip`, `lint`, in that order.
- Commit message exact text, no backticks — Task 4 Step 14.
- Open questions flagged as PLACEHOLDER — two: the `@www/core` mock shape in Task 1 Step 3, and the `@` alias resolution assumption in Task 2 Step 3 (both low-risk, precedented by `features/network`).

**Placeholder scan:** two explicit `PLACEHOLDER:` markers left (both flagged
above), no "TBD"/"handle appropriately" style gaps.

**Type consistency:** `CameraInfo` shape (`label`, `online`, `snapshotUrl`,
`streamUrl`, `entityId`) matches across `service.ts` (Task 1), `api.ts`'s
`CameraInfoSchema` (Task 3), and `web.tsx`'s `DogCamTileViewProps` (Task 2).
`getCameraInfo`/`openCameraStream` signatures match their call sites in `api.ts`
and `server.ts` respectively.
