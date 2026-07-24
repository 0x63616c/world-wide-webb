# Unit: Fold media cluster → features/tv + features/sound (Wave 6, heaviest)

Splits the one shared 334-line router `apps/api/src/trpc/routers/media.ts` into TWO
self-contained features BY CLIENT, then folds the four media tiles. This is an
interface-design task first (get the two api-facet boundaries right) and a mechanical
fold second. The tv/sound web closures are already cleanly separable — verified below,
there is NO component shared across the two sides.

The IMPLEMENTER runs the full per-unit verify chain (master plan §"Per-unit verify
chain") after EACH of the two commits, and watches CI to green in the foreground.

---

## Prerequisites this plan ASSUMES have landed (IMPLEMENTER must verify first)

This is a late-wave unit. Its clean split depends on earlier hoists/seams:

- **F0 multi-tile manifest** — `defineApp({ tiles: TileSpec[] })`; `home` on `TileSpec`.
  Proven by `features/weather`, `features/events`, `features/ac`, `features/ctrl` (all
  author `tiles: [...]`). REQUIRED — both new features register 2 tiles each.
- **P1.1 HA in `@www/core`** — `createHomeAssistantClient` + `HaError` exported from
  `@www/core`. Needed by `features/tv` (apple-tv-service).
- **P1.2/P1.3 Sonos + Spotify in `@www/core`** — `SonosClient`, the Spotify client.
  Needed by `features/sound`. (The enforcer already imports `SonosClient` from
  `@www/core`, confirming P1.2.)
- **P1.5 device-state trio** — `createPgDeviceStateStore`, `createPgIntegrationSyncStore`,
  `DeviceSpeakerState`, `isSpeakerState`, `DeviceKind`, `heartbeat`, `runCycle`,
  `windowOpen` all in `@www/core`. Needed by the relocated sonos-volume-enforcer.
- **S1 worker-job seam** — **`enqueueJob` + `JobType` + the `job` table live in
  `@www/core`.** This is the load-bearing assumption for relocating the
  **playlist-poller** into `features/sound` (see PLACEHOLDER-1). If `enqueueJob` is
  still only in `apps/api/src/jobs/queue.ts`, a `features/sound` file importing it is a
  `features/* → apps/api` Biome violation and this unit CANNOT land as written.
- **S3 http-route seam** — `defineHttp` facet + `collect.ts` Source-A scan of
  `features/<id>/http.ts` (verified present, `collect.ts:279`) + `http.gen.ts`
  emit + `server.ts` `findRoute(GENERATED_ROUTES, …)` iterator (verified,
  `server.ts:100`). Needed to move `/media/tv-artwork` off the hardcoded ladder.

IMPLEMENTER step 0: `grep` `@www/core` for `enqueueJob`, `createHomeAssistantClient`,
`SonosClient`, `createPgIntegrationSyncStore`. If any is missing, STOP and report — do
not hand-wire around a missing prerequisite.

---

## The router split: every procedure in media.ts → tv vs sound

`media.ts` today is a FLAT router `mediaRouter = router({ … })` mounted as
`media: mediaRouter` in `apps/api/src/trpc/routers/index.ts` baseRouter. It holds 20
top-level procedures plus one nested `spotify` sub-router (7 inner procedures). The
split is clean by client — every procedure belongs unambiguously to exactly one tile
family EXCEPT `addUrls` (resolved below).

### features/tv — router namespace key `tv` (10 procedures, Apple-TV / HA client)

| media.ts procedure | client / service |
| --- | --- |
| `tvNowPlaying` (+ `TvNowPlayingSchema`) | apple-tv-service `getTvNowPlaying` |
| `tvPlay` | `tvPlay` |
| `tvPause` | `tvPause` |
| `tvNext` | `tvNext` |
| `tvPrevious` | `tvPrevious` |
| `tvStop` | `tvStop` |
| `tvSeek` | `tvSeek` |
| `tvRemote` | `tvRemote` |
| `tvApps` | `getTvApps` |
| `tvLaunchApp` | `tvLaunchApp` |

### features/sound — router namespace key `sound` (11 top-level, Sonos + Spotify + ingest)

| media.ts procedure | client / service |
| --- | --- |
| `soundSystem` (+ `SoundSystemSchema`, `SoundSystemRoomSchema`) | sonos-sound-system-service |
| `sonosSetVolume` | sonos-volume-enforcer-service `setSpeakerDesiredVolume` |
| `sonosSetMute` | sonos-write-service |
| `sonosTransport` | sonos-write-service |
| `sonosGroupJoin` | sonos-write-service |
| `sonosGroupLeave` | sonos-write-service |
| `sonosSetLineIn` | sonos-write-service |
| `sonosGrabTvToBeam` | sonos-write-service |
| `sonosFavorites` (+ `SonosFavoriteSchema`) | sonos-favorites-service |
| `spotify` (nested sub-router: `nowPlaying`, `browse`, `play`, `pause`, `next`, `previous`, `seek` + all Spotify* schemas) | spotify-service |
| `addUrls` (+ `parseYoutubeVideoId`, `newId`) | media-ingest (`mediaSource`/`mediaItem` tables + `enqueueJob`) |

Counts: **10 → tv, 11 → sound** (one of which is the 7-proc `spotify` sub-router). One
procedure does not split by "which player is it": `addUrls` — resolved next.

### Resolved: `addUrls` belongs to features/sound

`addUrls` is the paste-links YouTube intake. It writes `mediaSource`/`mediaItem` and
enqueues `youtube_ingest`. It touches NO Apple-TV or Sonos/Spotify client. Ownership
follows the **tables**: `mediaSource`/`mediaItem` move to `features/sound/schema.ts`
(master plan §Wave 6 sound file list), so `addUrls` — the only tRPC writer of those
tables — moves with them into `features/sound/api.ts`. The pure helpers
`parseYoutubeVideoId` and `newId` move alongside it (into `features/sound/service.ts`
or a small `ingest.ts`). No current web caller of `addUrls` exists (grep: only the
router + `apps/api/src/__tests__/media-adduris.test.ts`), so the client-side rename is
just relocating that intake test to the feature — see PLACEHOLDER-3.

### Procedure names: keep VERBATIM, only the top namespace changes

Do NOT rename the procedures (keep `tvNowPlaying`, `sonosFavorites`, etc). Only the
mount key changes: `trpc.media.X` → `trpc.tv.X` (tv procs) / `trpc.sound.X`
(sound procs) / `trpc.sound.spotify.X`. This keeps the split mechanical and
diff-reviewable. The slight `trpc.tv.tvNowPlaying` redundancy is accepted (matches the
zero-rename-risk principle; a later cosmetic rename is cheap and out of scope). No
shared procedure or type crosses the boundary — each Zod schema is used by exactly one
side, so schemas move whole with their procedures. No duplication needed.

### Client call-site repoint (all in apps/web, ALL move into the features)

Every `trpc.media.*` reference lives in a file that is itself moving into a feature web
closure, so the repoint happens as part of the move — there is no orphaned caller left
in `apps/web`. Full census (`grep -roE "trpc\.media\.[a-zA-Z.]+"`):

- tv side (→ `trpc.tv.`): `tvNowPlaying`, `tvPlay`, `tvPause`, `tvNext`, `tvPrevious`,
  `tvSeek`, `tvRemote`, `tvApps`, `tvLaunchApp` — in `TvNowPlayingTile.tsx`,
  `TvAppsTile.tsx`, `detail/wiring/tv.tsx`, `detail/wiring/tv-apps.tsx`,
  `__tests__/TvNowPlayingTile.test.tsx`.
- sound side (→ `trpc.sound.`): `soundSystem`, `sonosSetVolume`, `sonosSetMute`,
  `sonosTransport`, `sonosGroupJoin`, `sonosGroupLeave`, `sonosSetLineIn`,
  `sonosGrabTvToBeam`, `sonosFavorites`, `spotify.browse` (+ the rest of the spotify
  sub-router) — in `SoundSystemTile.tsx`, `QuickPlayTile.tsx`, `GroupsModal.tsx`,
  `detail/wiring/sound.tsx`, `detail/wiring/quickplay.tsx`, and
  `__tests__/derive-sources.test.ts` (if it references trpc).

---

## features/tv layout

Mirror `features/ac` (deps.ts pattern) + `features/weather` (2-tile manifest) +
`features/dogcam` (a feature that owns an http.ts route family).

```
features/tv/
  manifest.ts     # 2 tiles: tile_tv + tile_tvapps (coords verbatim, neither home)
  api.ts          # defineApi(router({ tv: tvRouter })) — 10 tv procedures
  service.ts      # apple-tv-service.ts moved verbatim; getTvArtwork lives here
  http.ts         # defineHttp([{ GET /media/tv-artwork → getTvArtwork }])
  config.ts       # z.object({ HA_URL, HA_TOKEN }) slice (mirror features/ac/config.ts)
  deps.ts         # export const ha = createHomeAssistantClient({ baseUrl, token })
  web.tsx         # barrel: TvNowPlayingTile/View, TvAppsTile/View (manifest imports)
  web/…           # the tv web closure (below) incl. web/wiring/{tv,tv-apps}.tsx
  <tests + stories move with their components>
```

- **NO owned table** (tv reads nothing from Postgres). No `schema.ts`, no `db.ts`.
- `service.ts` = `apple-tv-service.ts` moved verbatim, with its two apps/api imports
  repointed: `import { ha } from "../integrations/homeassistant"` → `from "./deps"`;
  `import { HaError } from "../integrations/homeassistant/types"` → `from "@www/core"`
  (verify `HaError` is exported from core per P1.1; if not, this is a hoist gap to flag).
- `getTvArtwork()` (currently `apple-tv-service.ts:94`) moves with the service and is
  called by `http.ts`.

### features/tv manifest.ts (sketch — coords VERBATIM from tile-registry.ts:62-91)

```ts
import { defineApp } from "@app-kit";
import { TvNowPlayingTile, TvNowPlayingTileView, TvAppsTile, TvAppsTileView } from "./web";

export default defineApp({
  id: "tile_tv", // app id = the home-family tv tile id; distinct-from-tile-id not needed (matches an owned tile), fine
  tiles: [
    {
      id: "tile_tv",
      label: "TV",
      component: TvNowPlayingTile,
      viewComponent: TvNowPlayingTileView,
      worldCol: 18, worldRow: 24, cols: 4, rows: 3,
    },
    {
      id: "tile_tvapps",
      label: "TV Apps",
      component: TvAppsTile,
      viewComponent: TvAppsTileView,
      worldCol: 30, worldRow: 32, cols: 4, rows: 2,
    },
  ],
});
```

### features/tv http.ts (sketch — moved off the hardcoded server.ts:123 branch)

```ts
import { defineHttp } from "@app-kit";
import { getTvArtwork } from "./service";

// Now-playing artwork proxy (www-dhhr), moved verbatim off server.ts's hardcoded
// ladder onto the S3 route table. CORS is overlaid centrally by server.ts — do NOT
// set it here (mirror apps/api/src/http/booth.http.ts).
export const routes = defineHttp([
  {
    method: "GET",
    path: "/media/tv-artwork",
    match: "exact",
    handler: async () => {
      const artwork = await getTvArtwork();
      if (!artwork) return new Response("Not Found", { status: 404 });
      return new Response(artwork.body, {
        status: 200,
        headers: {
          "Content-Type": artwork.headers.get("content-type") ?? "application/octet-stream",
          "Cache-Control": "public, max-age=300",
        },
      });
    },
  },
]);
```

Then DELETE the `if (url.pathname === "/media/tv-artwork")` block (`server.ts:123-137`)
AND the now-unused `import { getTvArtwork } from "./services/apple-tv-service"`
(`server.ts:12`). knip will fail the commit if that import is left dangling.

### features/tv web closure (moves to features/tv/web/, → `trpc.tv.` repoints)

Source components (verified TV-exclusive — no sound-side importer):
`TvNowPlayingTile`, `TvNowPlayingTileView`, `TvAppsTile`, `TvAppsTileView`,
`TvRemoteModal`, `AllAppsModal`, `tv-app-logos`, `TransportScrubModal`
(imported ONLY by `detail/wiring/tv.tsx`), `hooks/useLivePosition`, plus wiring
`detail/wiring/tv.tsx` + `detail/wiring/tv-apps.tsx` (→ `features/tv/web/wiring/`).
Each carries its `.stories.tsx` and `__tests__/*` sibling. **~22 files.**

---

## features/sound layout

Mirror `features/ctrl` (owns tables + db.ts + device_state) + `features/sound` file
list in master plan §Wave 6.

```
features/sound/
  manifest.ts     # 2 tiles: tile_sound + tile_quickplay (coords verbatim, neither home)
  api.ts          # defineApi(router({ sound: soundRouter })); spotify nested under sound
  service.ts      # sonos-favorites + sonos-sound-system + sonos-write + spotify services
                  #   (merge or keep as separate co-located modules under the feature)
  ingest.ts       # parseYoutubeVideoId + newId + addUrls body (media-ingest)
  schema.ts       # mediaSource + mediaItem tables (moved from apps/api db/schema.ts)
  db.ts           # createPool(config.DATABASE_URL) + drizzle({ schema }) + stores
  config.ts       # DATABASE_URL + SPOTIFY_CLIENT_ID/SECRET/REFRESH_TOKEN (z.string().default("")
                  #   matching apps/api/src/env.ts defaults) + any SonosClient config key
  deps.ts         # deviceStateStore + integrationSyncStore ONLY (for the enforcer).
                  #   The Spotify singleton does NOT live here — it stays in service.ts.
  enforcer.ts     # sonos-volume-enforcer-service moved here (hand-wired interval)
  poller.ts       # playlist-poller-service moved here (hand-wired interval)
  web.tsx         # barrel: SoundSystemTile/View, QuickPlayTile/View
  web/…           # the sound web closure (below) incl. web/wiring/{sound,quickplay}.tsx
  <tests + stories move with their components>
```

Naming of the co-located service modules is the implementer's call (keep the four
`sonos-*` files verbatim under `features/sound/` for a smaller diff, OR merge — prefer
verbatim moves to keep the diff reviewable; only rewrite import lines).

### features/sound manifest.ts (sketch — coords VERBATIM from tile-registry.ts:72-101)

```ts
import { defineApp } from "@app-kit";
import { SoundSystemTile, SoundSystemTileView, QuickPlayTile, QuickPlayTileView } from "./web";

export default defineApp({
  id: "tile_sound",
  tiles: [
    {
      id: "tile_sound",
      label: "Sound System",
      component: SoundSystemTile,
      viewComponent: SoundSystemTileView,
      worldCol: 22, worldRow: 31, cols: 4, rows: 3,
    },
    {
      id: "tile_quickplay",
      label: "Quick Play",
      component: QuickPlayTile,
      viewComponent: QuickPlayTileView,
      worldCol: 26, worldRow: 32, cols: 4, rows: 2,
    },
  ],
});
```

### features/sound schema.ts — mediaSource + mediaItem

Move both tables VERBATIM from `apps/api/src/db/schema.ts:114-150` into
`features/sound/schema.ts`, and DELETE them from `apps/api/src/db/schema.ts`. Then:

- `apps/api/src/worker-deps.ts` re-exports `mediaSource`/`mediaItem` for the worker
  image — repoint that re-export to `@features/sound/schema` (apps→features allowed), or
  drop it if the only consumers now import from the feature directly.
- **`youtube-ingest-service.ts`** (the `youtube_ingest` job HANDLER, stays app-level —
  PLACEHOLDER-2 = **Option B**, RESOLVED) imports `mediaItem` — repoint ONLY that import
  `import { mediaItem } from "../db/schema"` → `@features/sound/schema` (apps/api →
  @features is the ALLOWED direction). Its `import { db } from "../db/index"` and
  `import { env } from "../env"` STAY (handler remains an apps/api citizen; does NOT adopt
  the feature db/config). It does NOT move. **Do NOT delete `worker-deps.ts:40`
  (`runYoutubeIngest`)** — the worker entry still imports it (see enforcer/poller section).
- Any other importer of these tables (`grep -rn "mediaItem\|mediaSource"`): repoint to
  the feature. The dup-table validator (`scripts/apps-gen/validate.ts`) THROWS if both
  the old schema.ts and the feature schema define `media_source`/`media_item`, so the
  deletion from apps/api schema.ts is mandatory in the SAME commit.

### Relocated sonos-volume-enforcer (hand-wired interval, worker imports from @features/sound)

`sonos-volume-enforcer-service.ts` moves to `features/sound/enforcer.ts` VERBATIM with
these import repoints (it already imports the domain logic from `@www/core`):

- `import { deviceStateStore } from "../db/device-state-store"` → `from "./deps"`
- `import { integrationSyncStore } from "../db/integration-sync-store"` → `from "./deps"`
- `import type { DeviceSpeakerState } from "../db/schema"` → `from "@www/core"`
  (`DeviceSpeakerState` originates in `packages/core/src/device-state/schema.ts:51`; the
  apps/api `db/schema.ts` only re-exports it — verified).

`features/sound/deps.ts` (mirror `features/ctrl/db.ts` + `features/ac/deps.ts`):

```ts
import { createPgDeviceStateStore, createPgIntegrationSyncStore, createPool } from "@www/core";
import { drizzle } from "drizzle-orm/node-postgres";
import { config } from "./config";
import { deviceState } from "@www/core"; // the device_state table schema for the store
export const pool = createPool(config.DATABASE_URL);
const storeDb = drizzle(pool, { schema: { deviceState } });
export const deviceStateStore = createPgDeviceStateStore(storeDb);
export const integrationSyncStore = createPgIntegrationSyncStore(storeDb);
```

### Spotify client construction (MINOR — config, not env; resolves PLACEHOLDER-6)

`@www/core` exports the `SpotifyClient` **class only** (no factory), taking
`SpotifyCredentials { clientId, clientSecret, refreshToken }`
(`packages/core/src/spotify/types.ts:7-9`). Today `spotify-service.ts:34-40` lazily builds
its singleton from `env.SPOTIFY_*`. On the move into `features/sound/service.ts`, rewrite
those three reads to `config.SPOTIFY_CLIENT_ID` / `config.SPOTIFY_CLIENT_SECRET` /
`config.SPOTIFY_REFRESH_TOKEN` (from `features/sound/config.ts`). The singleton STAYS in
`service.ts` — it does NOT move to `deps.ts`. Confirm during the move whether the moved
`SonosClient` construction reads any env/base-URL key; if so, add that key to
`features/sound/config.ts` too (`SonosClient` class is already hoisted to `@www/core`).

Worker wiring (`apps/worker/src/index.ts`): the `sonos-volume-enforcer` Worker entry
(`index.ts:113-117`) currently imports `runSonosVolumeEnforcerCycle` from the
`@control-center/api/worker` barrel (`apps/api/src/worker-deps.ts:38`). Repoint the
worker's import to `@features/sound/enforcer` (worker → features is ALLOWED) and DELETE
the `worker-deps.ts:38` re-export line. The Worker entry's `name`/`intervalMs`/`run`
shape is unchanged — it stays a hand-wired 1s interval, NOT an S1 job.

**worker-deps.ts delete SCOPING (MAJOR — do not over-delete):** this unit deletes ONLY
two re-export lines from `worker-deps.ts`: `:37` (`runPlaylistPollerCycle`) and `:38`
(`runSonosVolumeEnforcerCycle`). **`:40` (`runYoutubeIngest`) STAYS** — the worker's
env-gated `youtube_ingest` block still imports it (PLACEHOLDER-2 Option B). Never touch
`:40`.

`setSpeakerDesiredVolume` (called by the `sonosSetVolume` tRPC mutation) also lives in
this module and is imported by `features/sound/api.ts`.

### Relocated playlist-poller (hand-wired 2m interval) — SEE PLACEHOLDER-1

`playlist-poller-service.ts` → `features/sound/poller.ts`, import repoints:
`db`/`mediaItem`/`mediaSource` → feature `db.ts`/`schema.ts`. **REQUIRED boundary edit
(non-optional):** repoint `enqueueJob` from `apps/api/src/jobs/queue` → `@www/core` (S1
landed: `packages/core/src/jobs/queue.ts` exports `enqueueJob`, `JobSpec`, `JobHandler`,
`JobTypeRegistry`). Importing it from `apps/api` is a `features/* → apps/api` Biome
violation that FAILS the commit. Same for any `JobType`/`JobHandler` type import — all
from `@www/core`. Worker: `playlist-poller` entry (`index.ts:178`) → import
`runPlaylistPollerCycle` from `@features/sound/poller`; delete `worker-deps.ts:37`.

### features/sound web closure (moves to features/sound/web/, → `trpc.sound.` repoints)

Source components (verified sound-exclusive): `SoundSystemTile`, `SoundSystemTileView`,
`QuickPlayTile`, `QuickPlayTileView`, `GroupsModal`, `GroupsModalView`, `FavoritesModal`,
`SpotifyModal`, `hooks/useGroupMembership`, `hooks/useMixer`, `hooks/useThrottledVolume`,
`lib/derive-sources`, `lib/sonos-constants`, plus wiring `detail/wiring/sound.tsx` +
`detail/wiring/quickplay.tsx` (→ `features/sound/web/wiring/`). Each carries its
`.stories.tsx` + `__tests__/*`. **25 files.**

Total web closure across both features: **47 files** (TV 22 / SOUND 25, zero cross-side
imports, no shared file) = the entire
`apps/web/src/components/media/` directory (media-exclusive — no external importer except
the 4 wiring files, `tile-registry.ts`, and two registry guard tests) + the 4
`detail/wiring/{tv,tv-apps,sound,quickplay}.tsx` files.

---

## apps/web edits (files that stay in apps/web but change)

1. `apps/web/src/lib/tile-registry.ts`:
   - DELETE the 4 registry entries `tile_tv`/`tile_sound`/`tile_tvapps`/`tile_quickplay`
     (`:62-101`) — folded manifests now supply them via `apps:gen` → `tiles.gen.ts`.
   - DELETE the 8 `import` lines for the media tile/view components (`:17-24`).
   - ADD `tvManifest` / `soundManifest` imports (mirror the existing folded-manifest
     imports `:1-14`) and union them into `TILE_REGISTRY` the same way weather/ac are
     unioned. Verify the mechanism: check how `weatherManifest`/`acManifest` reach the
     final `TILE_REGISTRY` (glob-collected `tiles.gen.ts` vs hand-imported manifest) —
     match exactly whatever weather does (2-tile precedent).
2. `apps/web/src/components/tiles/detail/registry.ts`:
   - Repoint `tvDetailEntry`, `tvAppsDetailEntry`, `soundDetailEntry`,
     `quickPlayDetailEntry` imports (`:24-27`) from `./wiring/*` to
     `@features/tv/web/wiring/*` and `@features/sound/web/wiring/*`. The `ENTRIES` array
     is unchanged (same 4 identifiers).
3. Guard tests `tile-title-sync.test.tsx` + `registry-guards.test.ts` reference the
   media components only via the registry, not by direct path — they should pass
   unchanged, but run them (they enforce label↔title sync and registry completeness).

## apps/api edits (the router split proper)

1. `apps/api/src/trpc/routers/index.ts`: after BOTH features exist and all callers
   repoint, remove `import { mediaRouter } from "./media"` and the `media: mediaRouter`
   key from `baseRouter`. `featureAppRouter` now supplies `tv` + `sound`. (Done in the
   sound commit — see commit structure.)
2. `apps/api/src/trpc/routers/media.ts`: progressively emptied (tv procs out in commit 1)
   then DELETED entirely in commit 2.
3. `apps/api/src/services/{apple-tv,sonos-favorites,sonos-sound-system,sonos-write,
   sonos-volume-enforcer,spotify,playlist-poller}-service.ts`: MOVED into the features
   (no re-export shims left behind — knip zero-tolerance).
4. `apps/api/src/db/schema.ts`: delete `mediaSource`/`mediaItem`.
5. `apps/api/src/server.ts`: delete the tv-artwork branch + its import.
6. `apps/api/src/worker-deps.ts`: delete ONLY `:37` (poller) + `:38` (enforcer)
   re-exports. KEEP `:40` (`runYoutubeIngest`) — worker still imports it (Option B).
7. `apps/api/src/__tests__/`: `media-adduris.test.ts`, `playlist-poller-service.test.ts`,
   `media-schema.test.ts` — move the ones that test MOVED code (addUrls, poller, schema)
   into the owning feature (`features/sound`). `youtube-ingest-service.test.ts` STAYS in
   `apps/api/src/__tests__/` (handler is app-level, Option B); repoint only its schema
   import to `@features/sound/schema`, and move it only if it stops resolving.

## GUEST_EXPOSED / allowlist

All 4 tiles are `guestExposed: false` (none appear in `features/guest-exposed.ts`
`GUEST_EXPOSED = ["tile_guestwifi"]`; both manifests OMIT `guestExposed`, defaulting
false). **No allowlist edit needed.** Do NOT add these to `guest-exposed.ts`.

---

## Commit structure — RECOMMENDATION: two atomic feature commits (NOT a standalone router-split commit)

A standalone "split the router first" commit is REJECTED: it would leave two feature
routers with no tiles, no web, and half-moved services — `apps:check` (codegen only
collects a facet when `manifest.ts` exists) and typecheck both go red. The router
cannot half-exist as its own green commit.

Instead, fold `F-media-split` INTO the two feature commits. `media.ts` is progressively
emptied and each commit is independently green + deployable:

**Commit 1 — `feat(features): fold tv + tvapps tiles into features/tv (Wave 6)`**
END STATE: `media.ts` still mounted as `media:` holding the 11 SOUND procs; sound tiles
still ONLY in `tile-registry.ts` (no dup); sound web still calls `trpc.media.sonos*`.
Independently green + deployable.

Explicit file list:
- CREATE `features/tv/`: `manifest.ts`, `api.ts`, `service.ts` (apple-tv-service verbatim
  + `getTvArtwork`, imports repointed: `ha`→`./deps`, `HaError`→`@www/core`), `http.ts`
  (tv-artwork route), `config.ts` (`HA_URL`/`HA_TOKEN`), `deps.ts` (`ha` client),
  `web.tsx` + the **22-file tv web closure** under `features/tv/web/` incl.
  `web/wiring/{tv,tv-apps}.tsx`, with `.stories.tsx`/`__tests__` siblings; all
  `trpc.media.tv*` → `trpc.tv.*`.
- EDIT `apps/web/src/lib/tile-registry.ts`: delete `tile_tv`/`tile_tvapps` entries +
  their 8 component imports; add `tvManifest` import + `FEATURE_MANIFESTS` entry.
- EDIT `apps/web/src/components/tiles/detail/registry.ts`: repoint `tvDetailEntry` +
  `tvAppsDetailEntry` imports to `@features/tv/web/wiring/*`.
- EDIT `apps/api/src/trpc/routers/media.ts`: REMOVE the 10 tv procs + `TvNowPlayingSchema`
  + the apple-tv-service import. `media.ts` still exports `mediaRouter` (sound procs) and
  stays mounted.
- EDIT `apps/api/src/server.ts`: delete the `/media/tv-artwork` branch (`:123-137`) + the
  `getTvArtwork` import (`:12`).
- DELETE `apps/api/src/services/apple-tv-service.ts` (moved; no shim).
- `apps:gen`; full verify chain; commit; push; watch CI green.

**Commit 2 — `feat(features): fold sound + quickplay tiles into features/sound (Wave 6)`**
END STATE: `media.ts` DELETED, `media:` removed from baseRouter, sound tiles supplied by
`soundManifest`, tables owned by the feature. Independently green + deployable.

Explicit file list:
- CREATE `features/sound/`: `manifest.ts`, `api.ts` (sound router incl. nested `spotify`
  + `addUrls`), `service.ts` (sonos-favorites/sonos-sound-system/sonos-write/spotify
  verbatim; Spotify singleton reads `config`), `ingest.ts` (`parseYoutubeVideoId`+`newId`
  +addUrls body), `schema.ts` (`mediaSource`+`mediaItem`), `db.ts`, `config.ts`
  (`DATABASE_URL`+`SPOTIFY_*`), `deps.ts` (device_state stores), `enforcer.ts`
  (sonos-volume-enforcer; `enqueueJob` N/A), `poller.ts` (playlist-poller; `enqueueJob`
  → `@www/core`), `web.tsx` + the **25-file sound web closure** under
  `features/sound/web/` incl. `web/wiring/{sound,quickplay}.tsx` + siblings; all
  `trpc.media.*` → `trpc.sound.*` (incl. `trpc.sound.spotify.*`).
- EDIT `apps/api/src/db/schema.ts`: DELETE `mediaSource`/`mediaItem` (same commit as the
  feature adds them — dup-table validator).
- EDIT `apps/api/src/services/youtube-ingest-service.ts`: repoint `mediaItem` import →
  `@features/sound/schema` (db/env imports STAY; handler stays app-level).
- EDIT `apps/api/src/worker-deps.ts`: delete `:37` (poller) + `:38` (enforcer)
  re-exports; KEEP `:40` (`runYoutubeIngest`).
- EDIT `apps/worker/src/index.ts`: repoint poller entry → `@features/sound/poller`,
  enforcer entry → `@features/sound/enforcer`. youtube_ingest block UNCHANGED.
- EDIT `apps/api/src/trpc/routers/index.ts`: remove `import { mediaRouter } from "./media"`
  + the `media: mediaRouter` key.
- EDIT `apps/web/src/lib/tile-registry.ts`: delete `tile_sound`/`tile_quickplay` entries +
  their component imports; add `soundManifest`.
- EDIT `apps/web/src/components/tiles/detail/registry.ts`: repoint `soundDetailEntry` +
  `quickPlayDetailEntry` to `@features/sound/web/wiring/*`.
- DELETE `apps/api/src/trpc/routers/media.ts` entirely.
- DELETE moved apps/api services: `sonos-favorites-service.ts`,
  `sonos-sound-system-service.ts`, `sonos-write-service.ts`,
  `sonos-volume-enforcer-service.ts`, `spotify-service.ts`, `playlist-poller-service.ts`
  (no shims). `youtube-ingest-service.ts` is NOT deleted.
- MOVE tests: `media-adduris.test.ts`, `playlist-poller-service.test.ts`,
  `media-schema.test.ts` → `features/sound`. `youtube-ingest-service.test.ts` stays,
  schema import repointed.
- `apps:gen`; full verify chain; commit; push; watch CI green.

Ordering rationale: tv first because it is the smaller, table-free, HA-only half — it
proves the split mechanism (namespace change + http move) on lower risk before the
heavier sound commit (tables + two intervals + spotify + ingest). The two commits are
independent green states; if commit 2 hits trouble, commit 1 is already deployed and the
board still renders sound via the surviving `media:` router.

---

## Full verify chain (run after EACH commit, in order)

```
bun run apps:gen
bun run typecheck
bunx vitest run \
  features/tv features/sound \
  apps/web/src/components/media \
  apps/web/src/lib/__tests__/placeholder-tiles* \
  apps/web/src/components/tiles/__tests__/tile-title-sync.test.tsx \
  apps/web/src/components/tiles/__tests__/registry-guards.test.ts \
  apps/web/src/components/tiles/detail/__tests__ \
  apps/api/src/__tests__/media-adduris.test.ts   # (relocated path in commit 2)
bun run apps:check
bun run knip
bun run lint
git pull --rebase --autostash
git add <explicit paths only>          # NEVER git add -A
git commit -m "…"                      # NO backticks
git push
gh run watch <run-id> --exit-status    # FOREGROUND
# then confirm deploy green + pod image age
```

The **placeholder-tiles test is load-bearing** here: removing 4 tiles at
col18/22/26/30 rows 24-34 reshapes the bento fill — a 1x1-clearance regression
(memory `bento-tiler-1x1-clearance`) is exactly what this test catches. Run it after
EACH commit's registry deletion.

## Commit messages (no backticks)

- Commit 1: `feat(features): fold tv + tvapps tiles into features/tv (Wave 6)`

  Body: split the tv procedures out of the shared media router into features/tv/api.ts
  under the tv namespace; move apple-tv-service + the tv-artwork route onto the feature
  (http.ts, off the server.ts ladder); move the tv web closure and repoint trpc.media.tv*
  to trpc.tv.*; HA via the feature deps.ts client. media.ts retains the sound procedures.

- Commit 2: `feat(features): fold sound + quickplay tiles into features/sound (Wave 6)`

  Body: move the remaining Sonos/Spotify/media-ingest procedures into features/sound/api.ts
  under the sound namespace and delete media.ts; own mediaSource/mediaItem in the feature
  schema; relocate the sonos-volume-enforcer and playlist-poller as hand-wired worker
  intervals imported from @features/sound; repoint trpc.media.* to trpc.sound.*.

---

## Gotchas (inherit)

- `features/* → apps/api` is Biome-banned. HA via `features/tv/deps.ts`; Sonos/Spotify
  via `@www/core`; `enqueueJob` via `@www/core` (S1) — NEVER from apps/api. After each
  commit confirm the dep rule is green.
- `apps/api` + `apps/worker` MAY import `@features/*` (worker imports the enforcer +
  poller; youtube-ingest-service imports the feature schema — both allowed).
- ONE atomic commit per feature (backend + manifest + web together): codegen only
  collects a facet when `manifest.ts` exists, so a half-moved feature fails `apps:check`.
- knip zero-tolerance, whole tree: leave NO re-export shim behind after moving a service;
  delete the `worker-deps.ts` `:37`/`:38` re-export lines (poller + enforcer — NOT `:40`
  `runYoutubeIngest`) and the `server.ts` `getTvArtwork` import.
- `git add` silently aborts on an already-`rm`'d pathspec; verify each commit's contents
  with `git show --stat HEAD` before pushing.
- Shared working tree: parallel sessions push `main` (~8-10). `git pull --rebase
  --autostash`; stage EXPLICIT paths (never `git add -A`); lefthook format re-stages the
  whole tree — if a peer's dirt blocks a clean diff, `--no-verify` is the escape but only
  after confirming your own paths are clean.
- No backticks in `git commit -m` (zsh command substitution).
- `CLAUDE.md` is a symlink to `AGENTS.md` — never `sed -i` it.
- After moving the tables, `drizzle db:generate` is NOT required (no column change, just
  a file move) — but if a migration IS generated, `bunx biome format --write` its meta
  JSON before lint.
- Subagent must run `gh run watch --exit-status` in the FOREGROUND — do not yield to a
  background CI monitor (watchdog kills the agent).

---

## PLACEHOLDER markers — ALL 6 RESOLVED by review (verified against code)

All resolved; kept here for the audit trail. IMPLEMENTER step 0's grep is still the
final guard, but none of these should surprise you.

- **PLACEHOLDER-1 (TOP): `enqueueJob` in `@www/core`? YES — S1 landed** (`packages/core/
  src/jobs/queue.ts` exports `enqueueJob`/`JobSpec`/`JobHandler`/`JobTypeRegistry`;
  `features/notif/jobs.ts` already consumes it). Unit CAN land. Poller repoints
  `enqueueJob` → `@www/core` (required; see poller section). Original note retained:
  playlist-poller relocates INTO `features/sound` and needs `enqueueJob`. If S1 has NOT
  moved `enqueueJob`/`JobType`/the `job` table into `@www/core`, a `features/sound` file
  importing `enqueueJob` from `apps/api/src/jobs/queue.ts` is a `features/* → apps/api`
  Biome violation and THIS UNIT CANNOT LAND. Verify at IMPLEMENTER step 0. If S1 is not
  done, either (a) block this unit on S1, or (b) leave the poller app-level in apps/api
  importing the feature's tables (apps→features allowed) and hand-wire the worker to the
  apps/api poller — but that contradicts the master plan's "hand-wired via @features"
  instruction, so prefer (a).
- **PLACEHOLDER-2: youtube_ingest handler home → RESOLVED = Option B (keep hand-wired in
  apps/api).** Option A (a `features/sound/jobs.ts` `defineJobs` facet) is REJECTED: the
  worker registers `youtube_ingest` CONDITIONALLY (`apps/worker/src/index.ts:62-88`,
  `...(env.YOUTUBE_INGEST_ENABLED ? [...] : [])`) so a disabled+IP-blocked type PARKS
  instead of burning retries; a `defineJobs` facet is collected UNCONDITIONALLY into
  `GENERATED_JOBS`, defeating the park, and orphans the `hasSufficientDisk` disk-guard
  wrapper at the worker entry. Env-gated job specs are a separate seam-extension unit, not
  this fold. Option B: keep `runYoutubeIngest` in `apps/api/src/services/`, repoint ONLY
  its `mediaItem` import → `@features/sound/schema`, KEEP its `db`/`env` imports, KEEP
  `worker-deps.ts:40` + the worker's `youtube_ingest` block untouched.
- **PLACEHOLDER-3: `addUrls` client caller + its test home.** No web caller exists today
  (only `apps/api/src/__tests__/media-adduris.test.ts`). Confirm nothing outside the repo
  snapshot (e.g. a chat/paste feature landing in a parallel session) calls
  `trpc.media.addUrls`; if one appears, repoint it to `trpc.sound.addUrls`. Move the
  intake test into `features/sound`.
- **PLACEHOLDER-4: `HaError` export from `@www/core`.** `apple-tv-service.ts` imports
  `HaError` from `apps/api/src/integrations/homeassistant/types`. Confirm P1.1 exported
  `HaError` from `@www/core`; if it did NOT, that is a hoist gap to raise (do not
  re-import from apps/api — banned).
- **PLACEHOLDER-5: tile-registry union mechanism for the 2 new manifests.** Confirm HOW
  `weatherManifest`/`acManifest` reach `TILE_REGISTRY` (glob `tiles.gen.ts` consumer vs
  hand-imported manifest array) and mirror it EXACTLY for tv/sound — do not invent a new
  wiring path.
- **PLACEHOLDER-6: Spotify client config surface.** `features/sound/config.ts` must
  carry whatever Spotify credentials the `@www/core` Spotify client reads (P1.3). Confirm
  the exact env keys the core client expects and validate them in the feature config
  slice (mirror how the core client was configured pre-hoist).
