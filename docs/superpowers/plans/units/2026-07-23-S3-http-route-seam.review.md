# S3 HTTP-route seam — independent plan review

**Verdict: APPROVE-WITH-FIXES.** The plan is strong and faithfully mirrors the
landed S1 seam (facet → collect → `.gen.ts` barrel → generic runtime iterator,
proof consumers in commit 2). Route coverage is exact, `findRoute` precedence is
behaviour-preserving, central CORS is behaviour-preserving, and commit 1 is
genuinely inert. Two MAJOR gaps (both about *why* something is safe, not *whether*
it is) and three MINOR fixes below. No BLOCKER.

Counts: **0 BLOCKER, 2 MAJOR, 3 MINOR.**

---

## Independent route enumeration (server.ts `handle()`)

Counted every branch myself, in source order:

1. `OPTIONS` → 204 + CORS (`:102`)
2. `/up` exact, any method → 200 (`:106`)
3. `/health/climate` exact → `getClimate()` (`:115`)
4. `/media/tv-artwork` exact → `getTvArtwork()` (`:122`)
5. `/media/camera-stream` exact → `openCameraStream()` (`:143`)
6. `/media/wake-photo` exact + `POST` → `saveWakePhoto` (`:168`) **← migrates**
7. `/media/wake-photos/` prefix → `readWakePhoto` (`:197`)
8. `/media/booth-photo` exact + `POST` → `saveBoothPhoto` (`:225`) **← migrates**
9. `/media/booth-photos/` prefix → `readBoothPhoto` (`:275`)
10. `/trpc` prefix → `fetchRequestHandler` (`:291`)
11. 404 fallthrough (`:309`)

**= 11, exactly matching the plan's table.** S3 migrates ONLY #6 and #8; the
other 9 branches stay byte-identical in the residual ladder. **No route is at
risk of being dropped** provided the implementer deletes ONLY #6 and #8 (the
plan's §2c is explicit and correct — it even preserves #7, which sits *between*
#6 and #8 in source order).

## findRoute precedence — preserved, incl. the wake-photo / wake-photos collision

Verified by hand against the real matcher (§D5) and the real ladder:

- Only the two migrated **exact POST** routes ever live in `GENERATED_ROUTES`.
  `findRoute` returns one of them ONLY for an exact-path + POST match; every
  other request returns `undefined` and falls through to the unchanged ladder.
  No request the ladder used to handle is stolen; no double-handling (the two
  are removed from the ladder).
- **Prefix-collision case `POST /media/wake-photo` vs `GET/other /media/wake-photos/x`:**
  `/media/wake-photos/x` does not `=== "/media/wake-photo"` (no exact hit) and
  `GENERATED_ROUTES` holds no `prefix` routes → `findRoute` returns `undefined`
  → ladder → branch #7 `startsWith("/media/wake-photos/")` serves it. Correct.
  And `"/media/wake-photo"` does NOT start with `"/media/wake-photos/"`, so the
  migrated exact never leaks into #7. Behaviour identical to today.
- **Method gate:** `GET /media/wake-photo` → no exact (method POST-gated) → no
  prefix → ladder → #7 miss → … → 404. Identical to today (#6 is POST-gated).
- **OPTIONS:** handled by the early `req.method === "OPTIONS"` return *above*
  `findRoute`, so preflight never enters the table — unchanged.
- The exact-before-prefix + longest-prefix logic is forward-insurance only
  (`GENERATED_ROUTES` has no prefix routes in S3); it changes nothing today.

## Transitional home — sound and boundary-safe

`apps/api/src/http/{booth,wake}.http.ts`, collected via an explicit
`INTERIM_HTTP_MODULES` list (NOT `featureDirs()`), is the correct structural
mirror of S1's interim-augmentation pattern. The handlers cannot live in
`features/booth|wakes` yet: they call `saveBoothPhoto`/`saveWakePhoto`/`db` from
apps/api, and `features/* → apps/api` is Biome-banned (verified `biome.json`
`features/**` block bans `**/apps/api/**`). The generated barrel reaching
`../../apps/api/src/http/booth.http` is the same generated-glue direction
`schema.gen.ts` already uses (`export * from "../../apps/api/src/db/schema"` —
verified in the committed file). The interim list is greppable and gives each
fold a one-line delete + a `features/<id>/http.ts` add. **Sound.** (But see
MAJOR-1: the codegen-safety of importing this chain is unproven in the plan.)

## Multipart / raw-body fidelity — preserved (and the brief's "multipart" is a misnomer)

The two handlers are **raw-body**, not `multipart/form-data`:
`const bytes = new Uint8Array(await req.arrayBuffer())`. The brief calls this
"multipart photo upload"; that wording is loose — there is no multipart parsing
anywhere in either handler. The plan (§2a) moves the body **verbatim** and
preserves every load-bearing detail: single `arrayBuffer()` read, the
`x-captured-at`/`x-frame-idx`/`x-session-id`/`x-device-id` (+ booth
`x-mode`/`x-filter`/`x-group-id`/`x-source-only`) shape-validation regexes, the
mode-400 / filter-400 / group-id defaulting, and the 201/400 split. Fidelity
preserved. (See MINOR-5 — do not let anyone "fix" the title into real multipart.)

## CORS centralization — behaviour-preserving

Confirmed identical to today's `/trpc` treatment (`server.ts:305`
`for (const [k,v] of Object.entries(CORS_HEADERS)) res.headers.set(k,v)`):

- `Response.json(x, {status:201})` then overlay: `Response.json` sets only
  `Content-Type: application/json`; `CORS_HEADERS` has no `Content-Type`, so no
  header is clobbered. The 201 body/shape is unchanged.
- `new Response(msg, {status:400})` then overlay: identical CORS lands on the
  error, matching the inline version today.
- Response headers are mutable here (freshly constructed Responses, exactly like
  the `/trpc` overlay already mutates). No behaviour change.
- Residual ladder routes keep their inline CORS (unchanged). The mixed model
  (overlay for migrated, inline for residual) is per-route behaviour-identical.

## Commit 1 inert — genuinely

Empty `GENERATED_ROUTES = []` → `findRoute` always returns `undefined` → every
request falls to the unchanged 8-route ladder. No behaviour change. Verified the
empty-barrel emit path in `renderJobs` precedent (`emit.ts:187`) — `renderHttp`
mirrors it exactly.

## Proof test — genuinely dispatches a route

§2d level 2 imports `GENERATED_ROUTES` from `@features/_generated/http.gen`
(resolves in apps/api vitest via the `@features` alias — verified
`apps/api/vitest.config.ts:15`), builds a real `POST /media/wake-photo` Request,
runs it through `findRoute(...)?.handler(req, url)` with `saveWakePhoto` mocked as
a spy, and asserts spy-called + 201 + overlaid CORS. That is real dispatch
through the generated barrel, not an emission assertion. Genuine. (Mock-path nit:
MINOR-3.)

---

## Findings

### [MAJOR-1] The interim import chain's codegen-safety is unproven — prove it, and gate on an empty-env `apps:check`

`booth.http.ts`/`wake.http.ts` import `../db/index`, which imports `../env`.
`collect()` imports these modules during `apps:gen` **and** `apps:check` (run
`cd apps/web && bun …`). So codegen transitively imports apps/api's **entire**
`env.ts` — which runs `hydrateSecretFiles()` at module load, calls
`databaseUrlFromSecret()`, and `envSchema.parse(process.env)` — plus
`createPool(env.DATABASE_URL)` and `drizzle(pool, …)`.

This is codegen-safe **today** for two reasons the plan never states:
1. **Every field in `apps/api/src/env.ts` has a `.default()`** (verified —
   `DATABASE_URL` defaults to the local URL, `hydrateSecretFiles()` no-ops when
   no secret files exist, `databaseUrlFromSecret()` returns undefined without
   throwing), so `envSchema.parse({})` does not throw at import.
2. **The node-postgres pool is lazy** (no socket until first query), so
   `createPool`/`drizzle` at module load open nothing.

But the whole S1 design deliberately kept collected facets OFF apps/api's env —
`features/notif/db.ts` and `guest-wifi/config.ts` carry explicit "side-effect
free enough for the codegen to load … fails on first query, not on import"
contracts *precisely* so codegen never depends on this. The S3 interim modules
silently re-introduce that dependency via the apps/api `db` singleton, and the
plan asserts none of the safety.

**Fix:**
- Add a codegen-safety note to §D2 / §Gotchas: "collect() imports these interim
  modules, which transitively import apps/api's fully-defaulted `env.ts` +
  hydrateSecretFiles() + a lazy pg pool. This is safe ONLY because every
  apps/api env field is `.default()`ed and the pool is lazy; adding a
  non-defaulted required var to apps/api env.ts would break codegen."
- **Mandate the implementer verify `apps:check` (and `apps:gen`) run green with
  `DATABASE_URL` and all other vars UNSET** (e.g. `env -i PATH=$PATH bash -c
  'cd apps/web && bun run ../../scripts/apps-check.ts'`), proving the interim
  import chain does not throw at collect time. This is the single most important
  addition — it is the load-bearing assumption the whole interim approach rides
  on, and it is currently untested.

### [MAJOR-2] D1's rationale is stale post-S1 — app-kit no longer references any DOM global; fix the reason (the conclusion still holds)

D1 justifies putting `HttpRoute` (which names `Request`/`Response`/`URL`) in
app-kit by claiming "app-kit ALREADY tolerates those globals (`JobHandler = …
AbortSignal` in `define-facets.ts`)". **That is no longer true.** S1 moved
`JobHandler`/`AbortSignal` into `packages/core/src/jobs/queue.ts` (verified —
`JobHandler = (payload, signal: AbortSignal) => …` lives there now).
`app-kit/define-facets.ts` today references **zero** DOM globals (verified by
grep — it only `import type { JobSpec } from "@www/core"` and re-exports it). So
`HttpRoute`'s `Request`/`Response`/`URL` would be the **first** DOM reference in
app-kit's own source.

The **conclusion is still correct**, for a different reason I verified: app-kit
is typechecked by `tsconfig.config.json` (`include: ["app-kit/**/*.ts", …]`),
which `extends ./tsconfig.json`; the root tsconfig sets **no `lib`**, and with
`target: ES2022` TypeScript's default lib set includes `DOM`/`DOM.Iterable`. So
`Request`/`Response`/`URL` resolve at typecheck. (`skipLibCheck: true` also on.)

**Fix:** replace D1's stale "already tolerates via JobHandler/AbortSignal"
justification with the real one — root tsconfig sets no `lib`, so the default
DOM lib is present. Keep the §1a "confirm typecheck green, don't assume" gate.
PLACEHOLDER-3's `@app-kit/http` subpath fallback is unnecessary (bare `@app-kit`
type import resolves in apps/api tsconfig `:19` + vitest `:14`, proven by the
existing `@app-kit/server` edge) but harmless to keep as a documented fallback.

### [MINOR-3] Seam-test mock path is off by one directory

§2d says "mock `../services/wake-photo-service`". If the test lives at
`apps/api/src/http/__tests__/route-table.test.ts` (as §2d states), the service
is `../../services/wake-photo-service` from there — `../services/…` resolves to
the non-existent `apps/api/src/http/services/…`. A `vi.mock` whose path does not
resolve to the same module id the handler imports silently fails to mock (the
spy never fires → the test can false-pass or false-fail). **Fix:** state that the
mock path must resolve to the exact module id `wake.http.ts` imports
(`../services/wake-photo-service` *from the handler file*), i.e.
`../../services/wake-photo-service` from the `__tests__/` test file — or place
the test one level up to keep paths aligned.

### [MINOR-4] Commit-1 knip rationale is wrong (but commit 1 does stay green)

§Commit-1 verify claims `defineHttp` stays knip-green because it's "imported by
the (empty) collector path + the barrel". Neither imports it: `collect.ts`
imports `HTTP_FACET_BRAND`, and `http.gen.ts` imports `type HttpRoute`.
`defineHttp` has **no** runtime importer in commit 1 (no `*.http.ts` module and
the interim list is empty). It stays green for the real reason: knip treats
`app-kit/index.ts` as an entry (`knip.jsonc:89`
`"entry": […, "app-kit/index.ts", …]`) and honours `@public` (`tags: ["-public"]`,
`:18`) — exactly how `defineJobs` survived S1 commit 1 with no consumer (proven
in-tree; S1 is merged). **Fix:** correct the stated reason.

### [MINOR-5] Guard against "fixing" the misnomer into real multipart

The unit title and brief say "multipart"; the handlers are raw
`req.arrayBuffer()`. The plan's verbatim move is correct. Add a one-line note so
the implementer does not "modernize" the move into `req.formData()` /
multipart parsing — that would corrupt ingest (the panel POSTs a raw JPEG/GIF
body, not a form).

---

## PLACEHOLDER resolutions

- **PLACEHOLDER-1 (transitional home): RESOLVE → Option B** (interim apps/api
  home + `INTERIM_HTTP_MODULES` list). Boundary-safe, mirrors S1's
  interim-augmentation, and — subject to MAJOR-1's added empty-env `apps:check`
  gate — codegen-safe. This gives the team-lead's wanted real booth+wake proof
  consumers. Do NOT take Option D (seam-only); the empty-barrel path is already
  proven inert without it.
- **PLACEHOLDER-2 (CORS): RESOLVE → central overlay in the iterator.** Verified
  behaviour-preserving above (byte-identical to today's `/trpc` overlay; no
  header clobbered; 201 + 400 both get CORS). Approve central; it de-dupes a
  10x-appropriate seam.
- **PLACEHOLDER-3 (matcher/type homes): RESOLVE → as written** (`HttpRoute`/
  `defineHttp` in `app-kit/define-facets.ts`; `findRoute` in
  `apps/api/src/http/route-table.ts`). DOM lib is available at app-kit typecheck
  (MAJOR-2). Keep the `@app-kit/http` fallback note only as insurance.

## Bottom line

Structurally ready. Land MAJOR-1 (prove + empty-env-gate the interim codegen
import chain — the one real risk) and MAJOR-2 (fix the stale app-kit rationale);
apply the three MINORs while editing. No BLOCKER.
