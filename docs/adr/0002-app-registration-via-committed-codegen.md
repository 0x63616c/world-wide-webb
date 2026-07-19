# App registration is committed codegen over a file convention; runtime self-registration is forbidden

An App folder becomes runtime wiring through a committed **codegen** step (`bun run apps:gen`) that
globs `apps/*/manifest.ts` + the convention facet files (`web.tsx`, `api.ts`, `jobs.ts`,
`schema.ts`) and emits checked-in `apps/_generated/*.gen.ts` aggregates — byte-compatible with
today's hand-written `TILE_REGISTRY`, `appRouter` literal, and `Worker[]` array. The runtime stays
100% static. A CI guard (`apps:check`) re-runs codegen into a temp dir and fails if `git diff` on
`_generated/` is non-empty (the same drift-guard pattern the repo already uses for drizzle-meta).

## Considered options

- **File-convention + committed codegen (chosen).** The folder is the single source; `git diff` on
  `_generated/` catches drift. The one thing that crosses the `packages/api` type seam — the router —
  is emitted as an ordinary `router({ weather, network, … })` literal, so `AppRouter = typeof
  appRouter` stays fully concrete and flows to the web client unchanged. Cost: real codegen
  machinery.
- **Static manifest with hand-maintained facet barrels (rejected).** Adding an App still edits 4–5
  composition roots; the manifest's `routerKeys`/`workers`/`tables` string arrays duplicate the
  facet literals. Codegen makes those barrels *generated*, removing the edit-surface tax while
  keeping the consistency test.
- **Capability-slots with a `MergeApis` mapped type (rejected).** Reconstructs `AppRouter` from a
  runtime `mergeApiRouters(...) as MergeApis<...>` cast over a 19+ entry tuple; one non-literal
  namespace collapses the whole merged type — it gambles the exact invariant `packages/api` exists
  to protect.
- **Runtime self-registration into process-global arrays (FORBIDDEN).** This fails *unsafe under
  continuous delivery*: a missing barrel-import line or a duplicate tile id silently drops a live
  Tile from the Panel with **green CI**, and reconciling the router via `Object.assign(...) as
  SlicesOf<T>` lets the web `AppRouter` type claim `trpc.X` exists while the runtime never mounts it
  — a compile-green, runtime-404 hole. On a push-to-`main`-deploys-prod pipeline this is plausibly
  worse than the status quo. Do not reintroduce a runtime registry.

## Why it is recorded

Hard to reverse — codegen, the `_generated/` convention, and the drift guard are load-bearing
scaffolding the whole migration sits on. Surprising without context — committed generated files and
a "never hand-edit `_generated/`" rule invite "why not just a runtime registry / dynamic import?"
Real trade-off — codegen machinery bought in exchange for static end-to-end types and
deploy-safety; the rejected runtime registry is the tempting-but-dangerous alternative someone will
propose again, so its rejection is recorded explicitly.

Note: `app-kit/` and `apps/` are plain source directories, **not** workspaces — they must never
contain a `package.json`, or the `products/*` workspace glob would register them and disturb the
Dockerfiles and workspace guards.
