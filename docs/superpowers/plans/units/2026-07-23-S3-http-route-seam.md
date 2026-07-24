# Unit S3 — HTTP-route seam + booth/wakes upload uploads as proof consumers

> Track C, Phase 2 / Wave 5. Roadmap `~/.claude/plans/merry-hugging-river.md` §S3;
> master plan `docs/superpowers/plans/2026-07-23-track-c-master-execution.md`
> (Wave 5 · S3). This plan is for the IMPLEMENTER; a separate agent executes it.
> Mirror the JUST-LANDED S1 worker-job seam pattern
> (`docs/superpowers/plans/units/2026-07-23-S1-worker-job-seam.md`): a branded
> facet in app-kit → collected by `collect.ts` → emitted to a `.gen.ts` barrel →
> consumed by a generic runtime iterator, with the first consumers migrated in a
> second commit that proves the seam end-to-end.

## What this unit builds

The generic HTTP-route seam every future raw-route-owning feature inherits, then
proves it end-to-end by migrating the two photo-upload POST routes
(`POST /media/booth-photo`, `POST /media/wake-photo`) onto it.

Today: EVERY raw (non-tRPC) HTTP route is a hardcoded `if`-ladder inside
`handle()` in `apps/api/src/server.ts` (lines 100-310). Adding a feature's raw
route means hand-editing that switch. After S3: a feature (or, transitionally,
apps/api) declares its routes as a branded `defineHttp([...])` facet, codegen
emits `features/_generated/http.gen.ts` (an import barrel of the real route
specs), and `server.ts` ITERATES a generated route table instead of a
per-feature switch — falling through to the residual hand-wired routes, then
tRPC, then 404.

**Scope guard (do NOT violate):** S3 lands the SEAM and migrates ONLY the two
POST upload routes as proof. It does NOT fold the `booth` or `wakes` tiles — those
are SEPARATE Wave-5 units (`F-booth`, `F-wakes`) that DEPEND on S3. It does NOT
migrate the `/media/booth-photos/*` / `/media/wake-photos/*` serve routes (they
ride into `F-booth`/`F-wakes`), the `/media/camera-stream` route (`F-dogcam-stream`,
depends on S3), or `/media/tv-artwork` (Wave 6 tv fold). Those all stay hand-wired
in `handle()` after S3.

---

## Ground truth (verified this session — do not re-derive)

- **The complete current route ladder** (`apps/api/src/server.ts` `handle()`,
  in order). Every branch is enumerated so NONE is dropped — a missed route is a
  404 in prod:

  | # | Match | Method | Handler | S3 disposition |
  | --- | --- | --- | --- | --- |
  | 1 | (preflight) | `OPTIONS` | 204 + CORS | **stays in `handle()` wrapper** (not a facet) |
  | 2 | `/up` exact | any | `"OK"` 200 | stays hand-wired |
  | 3 | `/health/climate` exact | any | `getClimate()` | stays hand-wired |
  | 4 | `/media/tv-artwork` exact | any | `getTvArtwork()` | stays (Wave 6 tv fold) |
  | 5 | `/media/camera-stream` exact | any | `openCameraStream()` | stays (F-dogcam-stream) |
  | 6 | `/media/wake-photo` exact | `POST` | `saveWakePhoto(db, …)` | **MIGRATES (proof consumer)** |
  | 7 | `/media/wake-photos/` prefix | any | `readWakePhoto()` | stays (F-wakes) |
  | 8 | `/media/booth-photo` exact | `POST` | `saveBoothPhoto(db, …)` | **MIGRATES (proof consumer)** |
  | 9 | `/media/booth-photos/` prefix | any | `readBoothPhoto()` | stays (F-booth) |
  | 10 | `/trpc` prefix | any | `fetchRequestHandler` | stays LAST (always) |
  | 11 | (fallthrough) | any | 404 | stays LAST (always) |

  So the switch is **8 raw content routes (#2-#9)** + `/trpc` + the OPTIONS
  preflight + the 404 fallthrough. S3 migrates exactly #6 and #8; the other 6 raw
  routes stay hand-wired for their own later units.

- **Match kinds in use:** exact pathname (`===`), prefix (`.startsWith`), each
  optionally method-gated. The facet + iterator MUST support both `exact` and
  `prefix` from day one (design for 10x — the deferred serve/stream routes are
  prefix + method-agnostic, so `F-booth`/`F-wakes`/`F-dogcam-stream` must not have
  to reshape the facet).

- **CORS is applied per-branch today.** Each handler bakes `headers: CORS_HEADERS`
  into every `Response` (success AND 400). `/trpc` instead overlays CORS AFTER
  (`for (const [k,v] of Object.entries(CORS_HEADERS)) res.headers.set(k,v)`). The
  seam iterator adopts the `/trpc` style: it overlays CORS on every matched route
  Response centrally, so migrated handlers return bare Responses (§D3).

- **Aliases already resolve in apps/api — NO Dockerfile/alias work needed (unlike S1).**
  `apps/api/tsconfig.json:18-21` maps `@app-kit`→`app-kit/index.ts`,
  `@app-kit/server`→`app-kit/server.ts`, `@features/*`→`features/*`.
  `apps/api/vitest.config.ts:12-16` mirrors all three (with `@app-kit/server`
  ordered before `@app-kit`). `apps/api/Dockerfile:52` already does
  `cd apps/api && bun build src/server.ts …`, so the CWD tsconfig carries
  `@features` and `@app-kit` — adding
  `import { GENERATED_ROUTES } from "@features/_generated/http.gen"` to
  `server.ts` needs no build change. (`server.ts:1` already imports
  `@features/dogcam/service`, proving the runtime `@features` alias works here.)
  `scripts/check-alias-parity.sh` / `scripts/alias-parity.test.ts` enforce the
  three-way parity — no new alias is introduced, so parity is unaffected.

- **Biome boundary rules** (`biome.json`):
  - `features/* → apps/api` is BANNED (lines 168-177). This is why the migrated
    handlers cannot live in `features/booth`/`features/wakes` yet: they call
    `saveBoothPhoto`/`saveWakePhoto`/`db` from `apps/api`, and moving the service
    is the `F-booth`/`F-wakes` fold. (See §D2.)
  - The web-safe app-kit surface (`app-kit/**` except `server.ts`, lines 187-205)
    must NOT import `apps/api` or `features`. `defineHttp`/`HttpRoute` reference
    only globals (`Request`/`URL`/`Response`) — web-safe, fine. ✅
  - `apps/api → @app-kit` and `apps/api → @features` are ALLOWED (app-kit + the
    generated barrel are upstream of / consumed by apps/api). ✅
  - `packages/core → app-kit`/`features` is banned (lines 219+) — irrelevant, the
    seam type lives in app-kit, not core (§D4).

- **The photo services** (`apps/api/src/services/{booth,wake}-photo-service.ts`)
  export `saveBoothPhoto(db, bytes, meta)` / `saveWakePhoto(db, bytes, meta)` plus
  the `BOOTH_PHOTO_MODES` / `BOOTH_FILTER_PATTERN` / `newBoothGroupId` /
  `BoothPhotoMode` symbols the booth handler uses. Both take `db` injected. They
  stay in apps/api in S3.

- **The S1 emit + collect precedent** is exact and already in-tree:
  `renderJobs` (`emit.ts:159`) emits an import barrel (`import { jobs as … } from
  "../<dir>/jobs"`, spread into `GENERATED_JOBS: readonly JobSpec[]`); `collect.ts:153-179`
  detects `JOBS_FACET_BRAND` arrays and reads only data off each spec (never
  invokes the handler); `validate.ts:92-103` rejects duplicate job types;
  `scripts/apps-gen.ts:52` writes `jobs.gen.ts`. Mirror every one of these for http.

- **The manifest gate.** `collect.ts` `featureDirs()` (`:79`) only enumerates
  `features/<dir>` that contain `manifest.ts`. A `features/booth/http.ts` with no
  manifest would NOT be collected — and even if it were, it can't import the
  apps/api service (Biome). Hence the transitional home (§D2), collected via an
  explicit interim list, NOT via `featureDirs()`.

---

## Resolved decisions

### D1 — The `defineHttp` facet + `HttpRoute` type: in app-kit

Add to `app-kit/define-facets.ts` (alongside `defineJobs`/`defineCron`), export
from `app-kit/index.ts`:

```ts
export const HTTP_FACET_BRAND = Symbol.for("app-kit.http");

/**
 * One raw (non-tRPC) HTTP route. `handler` mirrors server.ts's `handle()` shape
 * exactly — raw bytes in via `req.arrayBuffer()`, a streamed/JSON `Response` out,
 * no tRPC context. CORS is overlaid centrally by the server iterator (do NOT set
 * CORS headers in the handler).
 */
export interface HttpRoute {
  /** Undefined = any method. Compared case-sensitively against `req.method`. */
  method?: string;
  /** Exact pathname (match "exact") or pathname prefix (match "prefix"). */
  path: string;
  /** Defaults to "exact". */
  match?: "exact" | "prefix";
  handler: (req: Request, url: URL) => Promise<Response>;
}

export function defineHttp(routes: HttpRoute[]): HttpRoute[] {
  return brand(routes, HTTP_FACET_BRAND);
}
```

**Why app-kit, not `@www/core` (where S1 put `JobSpec`):** the jobs seam moved its
type to core because the queue RUNTIME (`enqueueJob`/`claimOne`) lives in core.
The http seam has NO core runtime — the iterator lives in apps/api. Putting a type
that references the global `Request`/`Response`/`URL` DOM/Bun libs into `@www/core`
would force core's node/pg-oriented `tsconfig` lib to admit the DOM surface (core
today only touches `NodePgDatabase`). app-kit ALREADY tolerates those globals
(`JobHandler = (payload, signal: AbortSignal) => …` in `define-facets.ts` uses the
global `AbortSignal`), and `apps/api → @app-kit` is already a sanctioned edge
(`@app-kit/server`). So the type stays web-safe in app-kit; only the runtime
matcher (§D5) lives in apps/api. The gen barrel imports `type { HttpRoute } from
"@app-kit"` (verified bare `@app-kit` resolves in apps/api tsconfig + vitest).

**Authoring convention:** each http facet module exports `export const routes =
defineHttp([...])` (named `routes`, mirroring `jobs`/`api`).

### D2 — Where the two proof routes live post-seam: transitional `apps/api/src/http/`, collected via an interim list (RECOMMENDED)

**The constraint that forces this:** the migrated handlers call
`saveBoothPhoto`/`saveWakePhoto`/`db` from apps/api. `features/* → apps/api` is
Biome-banned, so an http facet can only live in `features/booth`/`features/wakes`
AFTER those services + tables move there — which IS the `F-booth`/`F-wakes` fold,
a separate Wave-5 unit that depends on S3. S3 must not fold them (it would empty
those units and violate the dep graph). Therefore the proof routes CANNOT live in
`features/` in S3.

**Recommendation — mirror S1's interim-augmentation pattern exactly.** S1 put its
interim `youtube_ingest`/`notify` registry augmentations in
`apps/api/src/jobs/queue.ts` and moved `notify` into `features/notif` at the fold.
S3 does the structurally identical thing for routes:

- New transitional files `apps/api/src/http/booth.http.ts` +
  `apps/api/src/http/wake.http.ts`. Each imports its apps/api service + `db`
  (legal — same package) and exports `export const routes = defineHttp([...])`.
- `collect.ts` collects these via an **explicit, greppable interim list** (§S3.2),
  NOT via `featureDirs()`. The list makes the transitional nature loud and gives
  `F-booth`/`F-wakes` a single line to delete when they fold.
- When `F-booth`/`F-wakes` land, each moves its service + table + `*.http.ts` into
  `features/<id>/` (legal there — the service is now in-feature, using the feature
  db), DELETES its interim-list entry, and the collector picks the facet up from
  the `features/<dir>/http.ts` path instead. Net seam shape unchanged.

This keeps the proof consumers REAL (actual booth/wake uploads served through the
generic iterator) without folding the tiles and without a Biome violation.

`features/_generated/http.gen.ts` importing `../../apps/api/src/http/booth.http`
is the SAME direction `schema.gen.ts` already uses
(`export * from "../../apps/api/src/db/schema"`) — generated glue reaching into
apps/api is allowed.

> **PLACEHOLDER-1 (manager confirm):** This recommends Option B (transitional
> apps/api home + interim collection list) so booth+wake are real proof consumers
> in S3. The alternative (Option D) is a seam-only S3: ship the iterator with an
> EMPTY `http.gen.ts`, migrate NEITHER route, and prove the seam with the codegen
> + iterator unit tests alone (no real consumer until `F-booth`/`F-wakes`). The
> team-lead's brief explicitly wants booth+wake as the first consumers, so Option
> B is recommended — but it introduces a second (interim) collection source, so
> confirm before implementing.

### D3 — CORS: overlaid centrally by the iterator (RECOMMENDED, behavior-preserving)

The migrated handlers today bake `headers: CORS_HEADERS` into every branch. The
seam iterator instead overlays CORS on the matched Response centrally — exactly
how `/trpc` already gets CORS (`server.ts:305`). Net behavior is identical (the
same CORS headers land on the 201 success and the 400 error), and it removes the
per-handler CORS duplication (a 10x-appropriate cleanup). Consequence: the moved
handler bodies DROP their inline `headers: CORS_HEADERS`; the test asserts CORS is
present on a served route so the centralization is proven, not assumed.

> **PLACEHOLDER-2 (manager confirm):** Central CORS in the iterator (recommended)
> vs. exporting `CORS_HEADERS` from a shared module and keeping it inline in each
> handler (a more literal verbatim move, more duplication). Recommend central.

### D4 — The generated barrel: `http.gen.ts`

Emit an import barrel of the real route specs (mirroring `renderJobs`, NOT a
data-only listing like `renderCrons`):

```ts
// features/_generated/http.gen.ts (generated)
// AUTO-GENERATED … DO NOT EDIT.
import type { HttpRoute } from "@app-kit";
import { routes as boothHttp } from "../../apps/api/src/http/booth.http";
import { routes as wakeHttp } from "../../apps/api/src/http/wake.http";

export const GENERATED_ROUTES: readonly HttpRoute[] = [
  ...boothHttp,
  ...wakeHttp,
];
```

Empty-barrel form (commit 1, before any consumer):

```ts
import type { HttpRoute } from "@app-kit";
export const GENERATED_ROUTES: readonly HttpRoute[] = [];
```

### D5 — The generic iterator: a pure matcher in apps/api

The runtime dispatch is apps/api's, not app-kit's (app-kit is authoring surface).
New `apps/api/src/http/route-table.ts` exports a PURE, unit-testable matcher:

```ts
import type { HttpRoute } from "@app-kit";

/**
 * First-match route lookup with exact-before-prefix precedence. Exact matches are
 * tried before any prefix, and among prefixes the LONGEST wins — so a future
 * broad prefix (e.g. "/media/") can never shadow a specific one
 * ("/media/booth-photos/") or an exact route. Method-gated: an undefined
 * route.method matches any method. Pure (no Request needed) so it unit-tests in
 * isolation.
 */
export function findRoute(
  routes: readonly HttpRoute[],
  method: string,
  pathname: string,
): HttpRoute | undefined {
  const methodOk = (r: HttpRoute) => r.method === undefined || r.method === method;
  const exact = routes.find(
    (r) => (r.match ?? "exact") === "exact" && r.path === pathname && methodOk(r),
  );
  if (exact) return exact;
  let best: HttpRoute | undefined;
  for (const r of routes) {
    if (r.match !== "prefix" || !pathname.startsWith(r.path) || !methodOk(r)) continue;
    if (!best || r.path.length > best.path.length) best = r;
  }
  return best;
}
```

`server.ts` calls it inside `handle()`, BEFORE the residual hand-wired ladder:

```ts
import { GENERATED_ROUTES } from "@features/_generated/http.gen";
import { findRoute } from "./http/route-table";

async function handle(req: Request, url: URL): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Generated route table (S3 seam). Iterated before the residual hand-wired
  // ladder; CORS is overlaid centrally here (mirrors the /trpc path), so route
  // handlers return bare Responses.
  const route = findRoute(GENERATED_ROUTES, req.method, url.pathname);
  if (route) {
    const res = await route.handler(req, url);
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
    return res;
  }

  // …residual hand-wired routes (#2-5, #7, #9), unchanged and still CORS-inline…
  // …/trpc … then 404 fallthrough …
}
```

**Precedence preserved:** the two migrated routes (#6, #8) are REMOVED from the
ladder (else the iterator + the ladder would both handle them — the iterator wins
by running first, but leaving the dead ladder blocks is wrong and knip/lint would
flag the now-unused service imports). The remaining routes keep their exact source
order. `/trpc` + 404 stay strictly last. Since all paths are disjoint today,
first-match ordering is behavior-identical; the exact-before-prefix rule is
forward-insurance for the deferred prefix routes.

### D6 — Commits: 2 (mirror S1)

1. **`feat(http): generic HTTP-route seam over app-kit facet + http.gen.ts (S3)`** —
   add `defineHttp`/`HttpRoute`/`HTTP_FACET_BRAND`; collect `HTTP_FACET_BRAND` (both
   the future `features/<dir>/http.ts` source AND the interim apps/api list, empty
   for now); emit `http.gen.ts` (empty barrel); add `findRoute`; wire the iterator
   into `server.ts` in front of the unchanged ladder. Behavior identical (empty
   table → nothing served by the seam, all 8 routes still hand-wired). Reviewable
   in isolation as "the seam".
2. **`feat(http): serve booth + wake photo uploads through the S3 route seam`** —
   add `apps/api/src/http/{booth,wake}.http.ts` (routes moved verbatim, minus
   inline CORS); add both to the interim collection list so `http.gen.ts` now
   contains them; DELETE branches #6 and #8 from `server.ts` `handle()` and the
   now-unused `saveWakePhoto`/`saveBoothPhoto`/booth-symbol imports it no longer
   uses; add the seam-proof tests. This is the first consumer that PROVES the seam.

Rationale mirrors S1: commit 1 is generic infra with zero behavior change; commit
2 is the proof. No atomic-manifest constraint here (no tile fold), so 1 commit
would also be defensible — but 2 keeps the keystone diff legible and lets the
Wave-5 boundary review diff the seam from its first consumer.

---

## Commit 1 — the seam (generic infra, no behavior change)

### 1a. Add the facet (app-kit)

- `app-kit/define-facets.ts`: add `HTTP_FACET_BRAND`, `HttpRoute`, `defineHttp`
  (§D1). Keep `brand()` reuse. No new imports (globals only).
- `app-kit/index.ts`: export `type { HttpRoute }` and `{ HTTP_FACET_BRAND,
  defineHttp }` (extend the existing facet export block).
- **Verify** `app-kit`'s tsconfig `lib` admits `Request`/`Response`/`URL` (it
  already compiles `AbortSignal` in `JobHandler`, so it should — confirm typecheck
  is green, don't assume).

### 1b. Collect `HTTP_FACET_BRAND` (two sources)

`scripts/apps-gen/collect.ts`:
- Import `HTTP_FACET_BRAND` from `../../app-kit/index` (join the existing
  `CRON_BRAND, JOBS_FACET_BRAND` import).
- Add types:
  ```ts
  /** A collected `defineHttp` route (for the dup-route validator). */
  interface CollectedHttpRoute {
    method: string | undefined;
    path: string;
    match: "exact" | "prefix";
    source: string;
  }
  /** A collected http facet MODULE (for the emit barrel). */
  interface CollectedHttpModule {
    ident: string;       // JS identifier for the import binding
    importPath: string;  // relative from features/_generated, no extension
    source: string;
  }
  ```
  Add `httpRoutes: CollectedHttpRoute[]` and `httpModules: CollectedHttpModule[]`
  to `AppModel`; add `hasHttp: boolean` to `CollectedFeature`.
- **Source A — future feature facets** (in the `featureDirs()` loop, next to the
  jobs scan): if `features/<dir>/http.ts` exists, import it, find the
  `HTTP_FACET_BRAND` array, push each route into `httpRoutes` (`source:
  "feature:<dir>"`) and one module `{ ident: ident(dir)+"Http", importPath:
  "../<dir>/http", source: "feature:<dir>" }` into `httpModules`; set
  `hasHttp = true`. Read only `method`/`path`/`match` off each spec — NEVER invoke
  the handler (mirror the jobs scan's data-only read at `collect.ts:163-167`).
- **Source B — interim apps/api transitional home** (explicit, greppable list,
  outside `featureDirs()`):
  ```ts
  // S3 transitional: booth/wake raw routes live in apps/api until F-booth/F-wakes
  // fold their tiles (Wave 5). Each fold DELETES its entry here and adds a
  // features/<id>/http.ts (Source A). Empty in commit 1.
  const INTERIM_HTTP_MODULES: readonly { file: string; ident: string; importPath: string; source: string }[] = [
    // { file: "apps/api/src/http/booth.http.ts", ident: "boothHttp", importPath: "../../apps/api/src/http/booth.http", source: "interim:booth" },
    // { file: "apps/api/src/http/wake.http.ts",  ident: "wakeHttp",  importPath: "../../apps/api/src/http/wake.http",  source: "interim:wake" },
  ];
  ```
  For each entry: import `join(REPO_ROOT, entry.file)`, read its `HTTP_FACET_BRAND`
  array into `httpRoutes`, push `{ ident, importPath, source }` into `httpModules`.
  (In commit 1 the list is empty/commented — the collector code path exists but
  yields nothing, so `http.gen.ts` is the empty barrel.)
- Sort `httpModules` deterministically by `source` (then `importPath`) before
  returning, so `bun run apps:gen` is byte-stable.
- Thread `httpRoutes` + `httpModules` into the returned `AppModel`; set `hasHttp`
  on each `CollectedFeature`.

### 1c. Emit `http.gen.ts`

`scripts/apps-gen/emit.ts` — add `renderHttp(model)` mirroring `renderJobs`
(`emit.ts:159`), driven by `model.httpModules`:

```ts
export function renderHttp(model: AppModel): string {
  const mods = model.httpModules; // already deterministically sorted in collect()
  if (mods.length === 0) {
    return `${GEN_HEADER}

import type { HttpRoute } from "@app-kit";

export const GENERATED_ROUTES: readonly HttpRoute[] = [];
`;
  }
  const imports = mods.map((m) => `import { routes as ${m.ident} } from "${m.importPath}";`).join("\n");
  const spread = mods.map((m) => `...${m.ident}`).join(",\n  ");
  return `${GEN_HEADER}

import type { HttpRoute } from "@app-kit";
${imports}

export const GENERATED_ROUTES: readonly HttpRoute[] = [
  ${spread},
];
`;
}
```

`scripts/apps-gen.ts`: import `renderHttp` and add
`writeFileSync(join(GEN_DIR, "http.gen.ts"), renderHttp(model))` in `main()`
(next to the `jobs.gen.ts` write at `:52`). Run `bun run apps:gen` to create the
initial committed `features/_generated/http.gen.ts` (empty barrel).

### 1d. Validate duplicate routes

`scripts/apps-gen/validate.ts`: add `httpRoutes?: { method?: string; path: string;
match: string; source: string }[]` to `Model`, and a dup check (mirror the dup
job-type check at `validate.ts:92-103`): two routes with the same
`method`+`path`+`match` would shadow each other. Key on
`` `${r.method ?? "*"} ${r.match} ${r.path}` ``; throw `CodegenError` on collision.

### 1e. The matcher + iterator (apps/api)

- New `apps/api/src/http/route-table.ts`: `findRoute` (§D5).
- `apps/api/src/server.ts`: add the two imports and the iterator block at the top
  of `handle()` (§D5). In commit 1 the table is empty, so this is a no-op
  fall-through — behavior identical; all 8 raw routes stay in the ladder below.

### Commit-1 verify

`bun run apps:gen` → `bun run typecheck` →
`bunx vitest run` (`scripts/apps-gen`, `apps/api`, `app-kit`) →
`bun run apps:check` (codegen drift + validator) → `bun run knip` →
`bun run lint`. Then commit + push + watch CI (§Full verify chain).

Knip note: in commit 1 `findRoute` is imported by `server.ts`, `GENERATED_ROUTES`
by `server.ts`, `renderHttp` by `apps-gen.ts`, `defineHttp`/`HttpRoute`/
`HTTP_FACET_BRAND` by the (empty) collector path + the barrel — all reachable, so
knip stays green even with the empty table. Confirm.

---

## Commit 2 — migrate the two upload routes (proof consumers)

### 2a. Transitional http facet modules

`apps/api/src/http/wake.http.ts` — the `/media/wake-photo` POST handler moved
VERBATIM from `server.ts:168-192`, minus inline CORS (§D3). Preserve the
raw-body handling EXACTLY (`new Uint8Array(await req.arrayBuffer())`, the
`x-captured-at`/`x-frame-idx`/`x-session-id`/`x-device-id` shape-validation, the
201/400 split):

```ts
import { defineHttp } from "@app-kit";
import { db } from "../db/index";
import { saveWakePhoto } from "../services/wake-photo-service";

export const routes = defineHttp([
  {
    method: "POST",
    path: "/media/wake-photo",
    match: "exact",
    handler: async (req) => {
      const headerTs = Number(req.headers.get("x-captured-at"));
      const capturedAt = Number.isFinite(headerTs) && headerTs > 0 ? headerTs : Date.now();
      const frameHeader = Number(req.headers.get("x-frame-idx"));
      const frameIdx = Number.isFinite(frameHeader) && frameHeader >= 0 ? frameHeader : 0;
      const rawSession = req.headers.get("x-session-id");
      const sessionId = rawSession && /^isn_[0-9a-z]{1,32}$/.test(rawSession) ? rawSession : null;
      const rawDevice = req.headers.get("x-device-id");
      const deviceId = rawDevice && /^[0-9A-Za-z_-]{1,64}$/.test(rawDevice) ? rawDevice : null;
      const bytes = new Uint8Array(await req.arrayBuffer());
      try {
        const path = await saveWakePhoto(db, bytes, { capturedAt, frameIdx, deviceId, sessionId });
        return Response.json({ path }, { status: 201 });
      } catch (err) {
        return new Response(err instanceof Error ? err.message : "invalid wake photo", { status: 400 });
      }
    },
  },
]);
```

`apps/api/src/http/booth.http.ts` — the `/media/booth-photo` POST handler moved
VERBATIM from `server.ts:225-270`, minus inline CORS. Import `BOOTH_PHOTO_MODES`,
`BOOTH_FILTER_PATTERN`, `newBoothGroupId`, `type BoothPhotoMode`, `saveBoothPhoto`
from `../services/booth-photo-service`; `db` from `../db/index`. Preserve the mode
400, the filter 400, the group-id defaulting, `x-source-only`, and the 201/400
split exactly. (The handler ignores `url`; keep the `(req, url)` signature but the
body only needs `req`.)

### 2b. Register both in the interim collection list

`scripts/apps-gen/collect.ts`: uncomment the two `INTERIM_HTTP_MODULES` entries
(§1b Source B).

### 2c. Remove the migrated branches from the ladder

`apps/api/src/server.ts`:
- DELETE branch #6 (`/media/wake-photo` POST, `:168-192`) and branch #8
  (`/media/booth-photo` POST, `:225-270`) from `handle()`.
- Remove now-unused imports: `saveWakePhoto` (keep `readWakePhoto`,
  `backfillWakePhotoIndex` — still used by #7 + the boot backfill); from the booth
  import, drop `BOOTH_FILTER_PATTERN`, `BOOTH_PHOTO_MODES`, `type BoothPhotoMode`,
  `newBoothGroupId`, `saveBoothPhoto` (keep `readBoothPhoto` — still used by #9).
  **Verify against the remaining ladder** which symbols are still referenced
  before deleting each import (knip will catch a miss, but check by hand — a
  wrongly-kept import is dead-code-red, a wrongly-dropped one is a typecheck
  failure).
- Re-run `bun run apps:gen` so `http.gen.ts` now imports both modules.

### 2d. Prove the seam (required — two levels, mirror S1's jobs-seam test)

1. **Codegen level** (`scripts/apps-gen/collect.test.ts` and/or `emit.test.ts`):
   assert `collect()` yields `httpRoutes` containing `{ method: "POST", path:
   "/media/wake-photo" }` and `{ method: "POST", path: "/media/booth-photo" }`,
   and that `renderHttp(model)` emits the `import { routes as wakeHttp }` /
   `boothHttp` lines and spreads them into `GENERATED_ROUTES`.
2. **Server seam level** (new `apps/api/src/http/__tests__/route-table.test.ts`)
   — the real proof that the GENERIC ITERATOR dispatches, not merely that a spec
   is emitted:
   - **Pure matcher tests:** `findRoute(GENERATED_ROUTES, "POST",
     "/media/wake-photo")` returns the wake route; `findRoute(…, "GET",
     "/media/wake-photo")` returns `undefined` (method gate); a synthetic
     exact-vs-prefix / longest-prefix case returns the right one (precedence).
   - **End-to-end dispatch proof:** import `GENERATED_ROUTES` from
     `@features/_generated/http.gen` (resolves at runtime via apps/api's vitest
     `@features` alias — verified present), mock `../services/wake-photo-service`
     so `saveWakePhoto` is a spy, build a real `POST /media/wake-photo` `Request`
     with a JPEG-ish body, run it through `findRoute(...)?.handler(req, url)`,
     and assert `saveWakePhoto` was called AND the Response is 201. This proves
     the route reachable through the generated barrel is the REAL wake handler and
     that invoking the collected spec executes the upload path — the S3 analogue
     of S1's "invoke the generated notify handler" test.
   - **CORS proof (guards §D3):** exercise the `server.ts` iterator path (or a
     thin helper extracted from it) so the overlaid `Access-Control-Allow-Origin`
     header is asserted present on a served route Response — confirming
     centralization is behavior-preserving. (If reaching the full `Bun.serve`
     `handle()` in a unit test is awkward, assert the overlay against the same
     `CORS_HEADERS` overlay logic factored alongside `findRoute`.)

### Commit-2 verify

`bun run apps:gen` → `bun run typecheck` → `bunx vitest run` (`scripts/apps-gen`,
`apps/api` incl. the new route-table test, `app-kit`) → `bun run apps:check` →
`bun run knip` (confirms the deleted service imports are gone and nothing dead is
left in `server.ts`) → `bun run lint`. Then commit + push + watch CI.

---

## Full verify chain (both commits, IMPLEMENTER runs in order)

```
bun run apps:gen                       # regenerate features/_generated/*.gen.ts (incl. http.gen.ts)
bun run typecheck
bunx vitest run <affected projects>    # scripts/apps-gen apps/api app-kit
bun run apps:check                     # codegen drift + validator (incl. new dup-route check)
bun run knip                           # zero-tolerance whole tree
bun run lint                           # Biome incl. noRestrictedImports dep-boundary rule
git pull --rebase --autostash          # parallel sessions push main
git add <explicit paths>               # NEVER git add -A
git commit -m "<message>"              # NO backticks
git push
gh run watch <run-id> --exit-status    # FOREGROUND — do not yield to a monitor (subagents stall)
# then confirm deploy green + pod image age (ci-cancelled-runs-strand-image-digests)
```

Extra checks specific to S3:
- No route dropped: after commit 2, curl-equivalent (or a smoke test) proves
  `POST /media/wake-photo` and `POST /media/booth-photo` still 201 on a valid body
  and 400 on an invalid one, AND the 6 un-migrated raw routes (#2-5, #7, #9) plus
  `/trpc` still respond. The Wave-5 boundary review smokes the photo upload + serve
  paths (the raw-body seam is the riskiest — master plan Wave-5 note).
- `bun run check-alias-parity` (if a standalone script) stays green — no new alias
  introduced (`@features/_generated/http.gen` rides the existing `@features` alias).
- Biome dep rule green: the transitional modules are apps/api→apps/api (legal); the
  gen barrel apps/api-direction reach is the sanctioned generated-glue precedent.

## Commit messages (no backticks, no em-dashes in -m)

1. `feat(http): generic HTTP-route seam over app-kit facet + http.gen.ts (S3)`

   Body: Add a defineHttp facet (method, path, match, handler(req,url)=>Response)
   in app-kit. Collect HTTP_FACET_BRAND from features http.ts plus an interim
   apps/api list and emit features/_generated/http.gen.ts as a route barrel.
   server.ts now iterates GENERATED_ROUTES via a pure findRoute matcher
   (exact-before-prefix, method-gated) before the residual hand-wired ladder,
   overlaying CORS centrally. Empty table in this commit: behaviour identical, all
   raw routes still hand-wired.

2. `feat(http): serve booth + wake photo uploads through the S3 route seam`

   Body: Move POST /media/booth-photo and POST /media/wake-photo into
   apps/api/src/http/{booth,wake}.http.ts as defineHttp facets (raw-body handling
   preserved verbatim, CORS overlaid by the iterator), register them in the interim
   collection list, and delete the two branches from the server.ts ladder. Add a
   seam-proof test that a route collected into http.gen.ts is dispatched by the
   generic iterator to the real handler. Tiles not folded (F-booth/F-wakes own that).

---

## Gotchas

- **The server switch is load-bearing — a dropped route is a silent 404 in prod.**
  All 11 branches are enumerated in Ground truth; S3 removes ONLY #6 and #8 and
  re-serves them through the seam. Do not touch #2-5, #7, #9, `/trpc`, the OPTIONS
  preflight, or the 404 fallthrough.
- **`features/* → apps/api` is Biome-banned** — this is exactly why the two routes
  live in the transitional apps/api home, not `features/`, in S3 (§D2). Do not
  create `features/booth/http.ts` in this unit.
- **Preserve raw-body handling exactly** — `new Uint8Array(await
  req.arrayBuffer())`, the header shape-validation regexes, and the 201/400 split.
  This is the riskiest surface; a subtle change (e.g. reading the body twice,
  altering a validation regex) corrupts ingest. Move the handler bodies verbatim.
- **CORS centralization is behavior-preserving but must be TESTED** (§D3) — assert
  the overlaid CORS header on a served route so the drop of inline CORS is proven
  safe, not assumed.
- **apps/api already resolves `@features` + `@app-kit` in tsconfig, vitest, AND the
  Dockerfile bun build** (`cd apps/api && bun build`, `:52`) — UNLIKE S1's worker,
  S3 needs NO Dockerfile or alias change. Do not add one. (`bun build` reads the
  CWD tsconfig `paths`; apps/api's already carries both aliases —
  `bun-build-alias-needs-cwd-tsconfig`.)
- **knip is zero-tolerance and scans the working tree.** After commit 2, the
  `saveWakePhoto`/`saveBoothPhoto`/booth-symbol imports removed from `server.ts`
  must be gone (dead import = red); the transitional `routes` exports must be
  reachable via `http.gen.ts` → `server.ts` (they are). Verify with `git show
  --stat HEAD` that only intended files are staged.
- **Determinism:** sort `httpModules` in `collect()` so `bun run apps:gen` twice is
  byte-identical (the emitter is a pure projection; ordering must be stable).
- **`bun run apps:gen` runs with cwd = apps/web** (it pulls TILE_REGISTRY through
  the `@/*` alias). The interim-list imports resolve by absolute path from
  `REPO_ROOT` (like `BASE_SCHEMA` at `collect.ts:14`), not cwd — use
  `join(REPO_ROOT, entry.file)`.
- **`app-kit` web-safe rule:** `defineHttp`/`HttpRoute` must not import apps/api or
  features (they don't — globals only). Confirm `bun run lint` stays green.
- Parallel sessions push `main` (~8-10 concurrent). `git pull --rebase --autostash`
  every time; NEVER `git add -A` (`never-git-add-all-shared-checkout`); lefthook
  format re-stages the whole tree — stage explicit paths and `git show --stat HEAD`
  before push (`lefthook-format-restages-whole-tree`).
- No backticks in `git commit -m` (zsh command substitution).
- `CLAUDE.md` is a symlink to `AGENTS.md` — never `sed -i` it.
- Subagents die if they yield to a background CI monitor — run
  `gh run watch --exit-status` in the FOREGROUND (`subagent-background-wait-stalls`).

## Open PLACEHOLDERs

- **PLACEHOLDER-1 (top) — transitional home for the two routes.** Recommended:
  Option B (apps/api/src/http/ + interim collection list, moved to
  features/{booth,wakes}/http.ts at their folds). Alternative: Option D (seam-only
  S3, empty barrel, defer both routes to F-booth/F-wakes, prove the seam with unit
  tests only). Team-lead brief wants booth+wake as proof consumers → Option B.
  Manager to confirm.
- **PLACEHOLDER-2 (top) — CORS handling.** Recommended: overlay centrally in the
  iterator (behavior-preserving, de-dupes). Alternative: export `CORS_HEADERS` from
  a shared module and keep it inline per handler. Recommend central.
- **PLACEHOLDER-3 (minor) — matcher/type homes.** `HttpRoute`/`defineHttp` in
  `app-kit/define-facets.ts`; `findRoute` in `apps/api/src/http/route-table.ts`.
  Verify `app-kit` tsconfig `lib` admits `Request`/`Response`/`URL` at typecheck; if
  the bare `@app-kit` type import in `http.gen.ts` ever fails to resolve, fall back
  to a `@app-kit/http` subpath (proven pattern via `@app-kit/server`).
