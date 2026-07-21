# Track 0 / Task 2 Sub-Plan: Guest Bundle on CC UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.
>
> Parent: `2026-07-21-track-0-product-merge.md` Task 2. Roadmap:
> `2026-07-21-consolidation-roadmap.md`.

**Goal:** Rebuild the captive-portal guest frontend as a second, tiny, self-contained build
inside `products/control-center/web`, on cc ui primitives + theme tokens, keeping the
captive-webview legacy-bundle fallback, with rewritten (non-stale) e2e coverage.

**Architecture:** The portal's flow layer is already deep and clean — a pure `flow.ts`
reducer + `effects.ts` running `PortalEffect`s through a `PortalClient` interface (the only
thing that touches tRPC). We port that layer verbatim, rebuild the 8 screens on cc
primitives, and give the guest entry its own vite config (`vite.portal.config.ts` →
`dist-portal/`) so the panel bundle, Capacitor sync (`dist/` only), and module graphs stay
fully separate. Guest tRPC type comes from a new `guestRouter = router({ portal:
portalRouter })` declared in the cc api — the exact router Task 3's listener will serve.

**Deviation from parent plan (recorded):** parent says "all portal e2e specs pass". Reality:
`a11y-landing`, `landing-validation`, `terms`, `refresh-persistence` assert a name/email
landing form (`#f-name`/`#f-email`) and sessionStorage persistence that do not exist in the
current password-only flow; `flow-matrix` is entirely `test.skip`. Those specs are stale
today. This sub-plan rewrites the e2e suite against the real flow (same coverage intent);
stale specs are not ported.

## Global Constraints

- Same as parent plan: every task green (`bun run typecheck` + named tests) → commit
  explicit paths → push `main`. Never `git add -A`.
- Guest bundle module graph must exclude `components/Board`, `lib/tile-registry`,
  `maplibre-gl`, and the settings store. Guests never download panel code.
- Storybook-first for new ui primitives (repo invariant).
- No fake/placeholder data; copy rules: guest UI never says "guest" (see
  `NetworkPill.tsx` comment — preserve this rule in ported copy).
- Keep the legacy-bundle loader semantics of the portal's `index.html`
  (`__ccPortalBooted` flag + 1200ms `vite-legacy-entry` fallback) — Apple CNA webviews skip
  module scripts; this is load-bearing for the actual guest device population.
- Dark-only guest page, pure-black background (`#000000`), self-hosted fonts only (no CDN
  requests) — same guarantees the old smoke spec asserted.

---

### Task 2.1: Guest router type in the cc api

**Files:**
- Create: `products/control-center/api/src/trpc/guest-router.ts`
- Test: `products/control-center/api/src/trpc/__tests__/guest-router.test.ts`

**Interfaces:**
- Consumes: `portalRouter` (`trpc/routers/portal.ts`), `router` from `trpc/init.ts`.
- Produces: `export const guestRouter = router({ portal: portalRouter })` and
  `export type GuestRouter = typeof guestRouter`. Task 3 (parent plan) serves exactly
  `guestRouter`; Task 2.4's web client types against `GuestRouter` via a type-only re-export
  added to `packages/api` (`packages/api/src/guest.ts`: `export type { GuestRouter } from
  "@control-center/api/trpc-guest"` — mirror how `packages/api/src/trpc.ts` re-exports
  `AppRouter`, including whatever package-exports entry `@control-center/api` needs).

- [ ] **Step 1: Failing test** — type-level + runtime: `guestRouter._def.procedures` contains
  exactly the `portal.*` procedures and nothing else (assert key set equality against
  `Object.keys(portalRouter._def.procedures)` prefixed `portal.`), guarding the security
  property "guest surface = portal only" at the type/router layer.
- [ ] **Step 2: Verify fail, implement (a ~6-line file), verify pass, typecheck.**
- [ ] **Step 3: Commit + push** — `feat(cc/api): guestRouter — portal-only router surface (ADR-0006)`.

### Task 2.2: Shared ui primitives — Button, Alert, Field, CheckboxRow

**Files:**
- Create: `products/control-center/web/src/components/ui/Button.tsx`, `Alert.tsx`,
  `Field.tsx`, `CheckboxRow.tsx` (+ stories per component under the repo's existing story
  convention; check a neighbour like `Segmented` for where stories live)
- Modify: `products/control-center/web/src/components/ui/index.ts` (exports)
- Test: component tests mirroring `products/captive-portal/apps/frontend/src/components/primitives.test.tsx` + `Field.reflow.test.tsx` coverage

**Interfaces:**
- Consumes: cc theme tokens (tailwind v4 + CSS vars; see Task 2.3 token step).
- Produces (port the portal props signatures verbatim):
  - `Button`: `variant: "primary" | "ghost"`, `loading?: boolean` (spinner + disable), plus standard button props.
  - `Alert`: `title?: string`, `children` (destructive/inline variant).
  - `Field`: `id, label, icon?, error?, optional?, children` + exported `fieldErrorId(id: string): string`.
  - `CheckboxRow`: `id, checked, error?, errorMessage?, onChange, children` (uses `fieldErrorId`).

- [ ] **Step 1:** Read the portal originals (`components/{Button,Alert,Field,CheckboxRow}.tsx`)
  and cc's `TextInput.tsx`/`Switch.tsx` for house style; write stories first, then components
  restyled with cc tokens (not `wwb-*` classes). Responsive: no fixed px widths.
- [ ] **Step 2:** Port the primitives/reflow tests; run
  `cd products/control-center/web && bunx vitest run src/components/ui` → green;
  storybook builds (`registry-guards`/stories-per-view guards apply to tile views, not ui/ —
  verify no guard fails).
- [ ] **Step 3: Commit + push** — `feat(cc/web): Button/Alert/Field/CheckboxRow ui primitives (guest bundle groundwork)`.

### Task 2.3: Guest entry scaffold — separate vite build + tokens split

**Files:**
- Create: `products/control-center/web/portal.html` (port the portal `index.html`: viewport,
  `theme-color #000000`, `__ccPortalBooted` legacy-fallback script; drop Geist preloads —
  fonts come from cc tokens)
- Create: `products/control-center/web/vite.portal.config.ts` (entry `portal.html`, outDir
  `dist-portal/`, `@vitejs/plugin-legacy`, react + tailwindcss plugins, `@` alias; dev
  server proxies `/trpc` → guest listener port once Task 3 lands — until then proxy to
  `localhost:4211`)
- Create: `products/control-center/web/src/portal/main.tsx`, `src/portal/portal.css`
- Create: `products/control-center/web/src/styles/tokens.css` — extract the shared CSS
  custom-property token layer (colors, radii, fonts) out of `src/styles/theme.css`;
  `theme.css` imports it; `portal.css` imports tokens + tailwind only (NOT `theme.css`, NOT
  `app-shell.css` — panel globals must not leak into the guest page)
- Modify: `products/control-center/web/package.json` (scripts: `build:portal`, `dev:portal`), root/product `build` script chains portal build
- Test: `products/control-center/web/src/portal/__tests__/bundle-isolation.test.ts`

**Interfaces:**
- Produces: `dist-portal/` static bundle; `src/portal/` as the guest app home; tokens.css consumed by both themes.

- [ ] **Step 1: Bundle-isolation test first** (the binding requirement): mirror the approach
  of `products/captive-portal/apps/api/src/cc-coupling-boundary.test.ts` — statically walk
  the import graph from `src/portal/main.tsx` and assert it never reaches
  `components/Board`, `lib/tile-registry`, `maplibre-gl`, or `lib/settings`. Fails now
  (no portal dir) — then scaffold a minimal boot (black page + heading) to green.
- [ ] **Step 2:** tokens.css extraction — inspect `src/styles/theme.css`, move ONLY custom
  properties/`@theme` mappings shared by both surfaces; panel visual output must be
  byte-identical (verify: storybook smoke + eyeball; no tailwind class behavior change).
- [ ] **Step 3:** `bun run build:portal` produces `dist-portal/` with legacy chunks;
  `bun run build` (panel) unchanged and does NOT contain portal entry (Capacitor `cap:sync`
  still ships `dist/` only). Typecheck green.
- [ ] **Step 4: Commit + push** — `feat(cc/web): guest bundle scaffold — portal.html, vite.portal.config, shared tokens layer`.

### Task 2.4: Port the flow layer + tRPC client

**Files:**
- Create: `products/control-center/web/src/portal/flow/flow.ts`, `flow/effects.ts` (verbatim
  port from `products/captive-portal/apps/frontend/src/flow/`, imports adjusted), + their
  existing unit tests ported alongside
- Create: `products/control-center/web/src/portal/lib/trpc.ts` — vanilla
  `createTRPCClient<GuestRouter>` (NOT `createTRPCReact`), `httpBatchLink({ url: "/trpc" })`
  (the guest listener serves `/trpc` directly — the old nginx `/api/trpc` rewrite dies with
  nginx), implementing the same `PortalClient` interface `effects.ts` consumes
  (`portal.status.query`, `portal.checkPassword.mutate`, `portal.authorize.mutate`)
- Create: `packages/api/src/guest.ts` type re-export (from Task 2.1's Produces block)
- Test: ported flow tests

**Interfaces:**
- Consumes: `GuestRouter` type (Task 2.1); `PortalClient` interface shape from the ported `effects.ts`.
- Produces: `runEffect(portalClient, effect)`, `reducer`, `FlowState`, `statusToEvent` — exactly the portal originals' signatures, for Task 2.5's App.

- [ ] **Step 1:** Port `flow/` + tests verbatim (they are pure — should pass untouched);
  `bunx vitest run src/portal/flow` green.
- [ ] **Step 2:** trpc client file; typecheck confirms `PortalClient` satisfied by the typed
  client; bundle-isolation test still green (client imports type-only from `@cc/api/guest`).
- [ ] **Step 3: Commit + push** — `feat(cc/web): port guest flow layer + portal-only trpc client`.

### Task 2.5: Rebuild the 8 screens + App shell on cc primitives

**Files:**
- Create: `products/control-center/web/src/portal/App.tsx` (port of portal `App.tsx`:
  useReducer state machine, `?id=`/`?mac=` read, the two effects — boot `status` call on
  `step==="password"`, `authorize` on `step==="connecting"`)
- Create: `src/portal/screens/{WifiPassword,Connecting,Success,AlreadyConnected,RateLimited,SessionExpired,GenericError,Terms}.tsx` — same props signatures as the originals (inventory recorded them; e.g. `WifiPassword`: `error, networkError, busy, agreed, onAgreeChange, onSubmit, onOpenTerms, initialValue?, initialShow?`), rendered with ui `Button`/`Alert`/`Field`/`CheckboxRow`/`TextInput` + cc tokens
- Create: `src/portal/components/icons.tsx` + `NetworkPill.tsx` (portal-local: icon set and
  pill are guest-specific; keep the no-"guest"-copy comment)
- Test: port `screens.test.tsx` coverage to the rebuilt screens
- Storybook: stories for each screen (they join cc's storybook glob — note: cc `.storybook/main.ts` composes the OLD portal storybook as a ref `captive-portal`; leave the ref for parent Task 5 to remove)

- [ ] **Step 1:** Screens + stories, one commit per 2-3 screens is fine (push each).
- [ ] **Step 2:** `bunx vitest run src/portal` green; storybook builds; bundle-isolation green.
- [ ] **Step 3: Commit + push** — `feat(cc/web): guest screens on cc ui primitives`.

### Task 2.6: e2e rewrite (password-only reality)

**Files:**
- Create: `products/control-center/web/e2e-portal/playwright.config.ts` (chromium only,
  `workers: 1`, `fullyParallel: false`, device Pixel 7, baseURL
  `http://127.0.0.1:4206` overridable via `PORTAL_E2E_BASE_URL`, webServer `bun run dev:portal`)
- Create: `e2e-portal/{smoke,a11y,validation,terms,flow}.spec.ts`
- Modify: `products/control-center/web/package.json` (`e2e:portal` script)

Coverage (replaces the stale suite's intent):
- `smoke`: page boots (h1 present), body background `rgb(0,0,0)`, zero non-localhost network requests (self-hosted fonts proof).
- `a11y`: WifiPassword — password field `#w-pass` labelled, error text wired via `aria-describedby` (use `fieldErrorId` ids), terms checkbox reachable by keyboard.
- `validation`: empty password submit → inline error; unchecked terms → checkbox error row.
- `terms`: open Terms from WifiPassword, back — entered password + checked state preserved.
- `flow`: happy path + wrong-password + rate-limited paths with `page.route` interception of `/trpc/portal.*` (mock transport, real reducer/UI).

- [ ] **Step 1:** Specs + config; `bunx playwright test -c e2e-portal` green locally.
- [ ] **Step 2:** Confirm CI story: e2e-portal is NOT wired into CI in this task (CI wiring
  rides parent Task 5's ci.yml edit); record that in the commit message.
- [ ] **Step 3: Commit + push** — `test(cc/web): guest bundle e2e suite (password-only flow)`.

---

## Self-review notes

- Parent's binding requirements: storybook-first ✅ (2.2, 2.5); bundle-isolation test ✅
  (2.3 Step 1); e2e ✅ (2.6, rewritten — deviation recorded up top); small bundle ✅
  (separate config, no panel imports).
- Old portal frontend is NOT deleted here — parent Task 5 does that (after Task 4 cutover).
- Task 3 (parent) consumes: `guestRouter` (2.1), `dist-portal/` (2.3) as `GUEST_STATIC_DIR`
  content; Dockerfile COPY of `dist-portal` into the api image is parent Task 4's
  check-dockerfile-manifests edit.
