# www-cuuw — Access gate for `*.worldwidewebb.co` (Cloudflare Access, bosun-managed)

Status: design (planning only — no code written)
Ticket: www-cuuw (P0)
Date: 2026-06-10
Decision source: brainstorm with Calum 2026-06-10 (memory `access-gate-design-cc-cuuw`). The mechanism is settled; this doc is the build plan, not a re-evaluation.

---

## 1. Overview & decision

Every `*.worldwidewebb.co` host (dashboard, api-via-dashboard, storybook, drizzle, hooks) is served through the single Cloudflare tunnel and is reachable by anyone with the URL. The dashboard's tRPC api is unauthenticated, so the URL controls the house. We lock this down at the **Cloudflare edge** with **Cloudflare Access** (free Zero Trust tier, ≤50 users), managed **declaratively in bosun** so it reconciles on every `bosun up` exactly like tunnel routes and DNS do today.

**The invariant Calum wants:** *default-deny.* A Cloudflare Access **wildcard app `*.worldwidewebb.co` with action `Block`** is the floor. Any subdomain not covered by a more specific allow policy is denied at the edge — including brand-new subdomains and accidental public routes. Above the floor sit explicit per-host allow apps.

**Why CF Access (not Tailscale split-DNS / mTLS):** rejected in the brainstorm — Tailscale needs LE cert management for the custom name, a tailnet resolver, and (ts.net variant) an iOS kiosk rebuild since `server.url` is baked into `capacitor.config.ts`; it also yields "absent" rather than an enforced "denied." CF Access enforces at the edge that all traffic already flows through (browser → CF edge → cloudflared → nginx → api; the OrbStack containers have **no LAN route**), so the api does **not** need to validate anything to be protected. This is the single-door property documented in memory `captive-portal-vs-edge-auth`.

**Per-host access matrix:**

| Host | Policy | Credential |
|---|---|---|
| `*.worldwidewebb.co` (floor) | **Block** | none — deny everything not allowed above |
| `dashboard.worldwidewebb.co` | Service Auth (allow) | **kiosk** service token (iPad, unattended) |
| `storybook.worldwidewebb.co` | Allow | email = `calumpeterwebb@icloud.com` (OTP) |
| `drizzle.worldwidewebb.co` | Allow | email = `calumpeterwebb@icloud.com` (OTP) |
| `hooks.worldwidewebb.co` | Service Auth (allow) | **CI** service token (GitHub Actions caller) |

`hooks` keeps its existing app-level `BOSUN_WEBHOOK_TOKEN` as belt-and-suspenders (two independent gates).

**Out of scope / deferred:** the in-app password page (inner origin layer) is explicitly deferred by Calum. It only becomes necessary if something later serves the dashboard/api over a non-CF path (LAN/tailnet split-horizon) — see memory `captive-portal-vs-edge-auth`. Origin-side `Cf-Access-Jwt-Assertion` validation is also deferred (optional hardening). Neither is built here.

---

## 2. Architecture

Three pieces, mirroring the existing route/DNS reconcile:

1. **Spec field** — a new optional `access:` field on `ServiceSpec` (`packages/bosun/src/spec.ts`) plus a wildcard "floor" declaration mechanism at the stack level. Declared per-service in `deploy.config.ts` alongside `route:`.
2. **`reconcileAccess` module** — `packages/bosun/src/reconcile/access.ts`, a sibling to `reconcile/routes.ts`. Dependency-injected `CloudflareAccessClient` interface (so unit tests use a fake, never a real API). It **lists** Access apps, **creates** declared apps + policies, **prunes only apps it owns** (tag/owner-scoped, never touches a foreign app), and **reads (lists) service tokens** to resolve a token name → its CF token id for the policy `include`. The interface methods: `listApps()`, `createApp()`, `updateApp()`/policy ops, `deleteApp()`, and **`listServiceTokens()`** (READ only — see §4). reconcileAccess does NOT create or delete service tokens; the save-script owns token creation (§4), and tokens are never pruned destructively.
3. **CLI wiring** — `reconcileCloudflare()` in `packages/bosun/src/cli.ts` gains an Access step after routes + DNS, inside the same advisory guard (a CF Access hiccup must never abort an otherwise-good deploy on the webhook path; an interactive `bosun access sync` exits non-zero on failure). Optionally add a `bosun access sync` subcommand mirroring `bosun routes sync` for manual runs.

### Cloudflare Access object model (what the API manages)

- **Application** — bound to one or more `domain`s (a hostname or a wildcard `*.worldwidewebb.co`). Type `self_hosted`. Created via `POST /accounts/{account_id}/access/apps`.
- **Policy** — attached to an app; `decision` ∈ `allow | deny | bypass | non_identity | service_auth`. `include` rules carry the principals (an `email` rule, or a `service_token` / `any_valid_service_token` rule). Created via `POST /accounts/{account_id}/access/apps/{app_id}/policies` (Access "reusable policies" also exist; we use app-scoped policies for simplicity and locality).
- **Service token** — `POST /accounts/{account_id}/access/service_tokens` returns the token **id**, `client_id` (non-secret) **and `client_secret` (returned ONCE, at creation)**. The caller sends `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers. For a **browser** (WKWebView) CF then mints a `CF_Authorization` cookie carried on subsequent subresource requests; for a **stateless caller** (curl/CI) there is no cookie — the headers authenticate each request directly (§4). A policy's `service_token` include rule references the token **id**, not the client_id; reconcileAccess gets that id via `listServiceTokens()` (token created out-of-band by the save-script — §4).

### Ownership & prune safety (the routes.ts pattern, applied)

Unlike tunnel ingress (which has no tag field, so routes.ts derives ownership from the origin service name), **Access apps carry native `tags`**. We tag every bosun-created app with `bosun:<stackName>` (reuse `stackRouteTag(stackName)` from routes.ts, or a dedicated `stackAccessTag`). `reconcileAccess` prunes **only** apps carrying our exact tag that are no longer declared. Foreign Access apps (none today, but defensive) are never touched. This is the exact safety contract of `reconcileRoutes` — list → create declared → prune only tag-owned orphans.

Service tokens are **never auto-pruned** (deleting a token instantly bricks whatever holds it; a stale token is harmless). Token lifecycle is create-if-missing only; rotation/deletion is a manual op documented in the runbook.

---

## 3. Data model — the `access:` field

Goal: declarations live next to `route:` in `deploy.config.ts`, are pure data (no I/O), and map deterministically onto CF apps + policies.

```ts
// spec.ts — new types
export type AccessRule =
  | { kind: "email"; email: string }
  | { kind: "serviceToken"; clientIdEnv: string }; // client-id read from env at reconcile

export interface AccessSpec {
  // Decision for the app's primary policy.
  decision: "allow" | "block" | "service_auth";
  // include rules (OR-ed). Empty for a pure block-everyone floor.
  include?: AccessRule[];
}

// On ServiceSpec:
//   access?: AccessSpec;   // per-host app, domain = svc.route
```

Per-host apps derive their `domain` from the service's existing `route:` (single source of truth — no second hostname to keep in sync). A service with `access:` but no `route:` is a spec error (validated in the `service()`/`access()` builder).

**The wildcard floor** is not a service — it has no origin. Model it as a **stack-level field**. Two options; recommend (a):

- **(a) A dedicated builder `accessFloor()`** returning an `AccessSpec`, set as a new **OPTIONAL** field on the `Spec` interface and the `stack()` builder: `stack(name, { services, accessFloor?: AccessSpec })`. Keeps the floor explicit and visible in `deploy.config.ts`.
- (b) Overload a service. Rejected — the floor has no service/origin; forcing it onto one is a lie.

**Signature-change impact (important — must not break existing code):**
- `Spec` is currently `{ stackName, services }` (`spec.ts:100-104`). Adding `accessFloor?: AccessSpec` as **optional** means every existing inline `Spec` literal still typechecks — including the ~15 inline `{ stackName, services }` objects in `reconcile.test.ts`. Confirm it ships optional; a required field would break all of those.
- `stack()` gains an optional `accessFloor` in its opts and threads it onto the returned `Spec`. No existing `stack()` call passes it → unchanged.
- **`cli.ts reconcileCloudflare` must read the floor from `spec.accessFloor`** (the new stack-level field), NOT from `spec.services`. Today it derives everything from `spec.services` (`cli.ts:198-205`); the Access step adds: per-host apps from `spec.services.filter(s => s.access)` PLUS the single floor app from `spec.accessFloor` (when present). When `spec.accessFloor` is undefined (the ship-now state), no floor app is desired.

`reconcileAccess` receives: the list of `{ domain, AccessSpec }` per-host apps (from services with `access:`), plus the optional wildcard-floor `AccessSpec` (from `spec.accessFloor`). It builds the desired app+policy set, diffs against live (by `domain` + our tag), creates/updates, prunes tag-owned orphans.

**Builder ergonomics (deploy.config.ts after this lands):**

```ts
service("web", {
  route: "dashboard.worldwidewebb.co",
  access: accessServiceToken({ clientIdEnv: "CF_ACCESS_KIOSK_CLIENT_ID" }),
  // ...
}),
service("storybook", {
  route: "storybook.worldwidewebb.co",
  access: accessEmail("calumpeterwebb@icloud.com"),
}),
service("drizzle", {
  route: "drizzle.worldwidewebb.co",
  access: accessEmail("calumpeterwebb@icloud.com"),
}),
service("bosun-agent", {
  route: "hooks.worldwidewebb.co",
  access: accessServiceToken({ clientIdEnv: "CF_ACCESS_CI_CLIENT_ID" }),
}),
// ...and the floor is a stack-level opt, not a service:
export default stack("control-center", {
  services: [ /* ... */ ],
  accessFloor: accessFloor(),   // *.worldwidewebb.co => Block
});
```

Helper builders (`accessEmail`, `accessServiceToken`, `accessFloor`) keep `deploy.config.ts` declarative and mirror `httpProbe`/`cmdProbe`/`fromOp`.

### Mapping each declaration to CF objects

| Declaration | CF app | CF policy |
|---|---|---|
| `accessFloor()` | app domain `*.worldwidewebb.co`, tagged | one policy `decision: block`, `include: [{everyone}]` |
| `accessEmail(x)` on host H | app domain H, tagged | policy `decision: allow`, `include: [{email: x}]` |
| `accessServiceToken({clientIdEnv})` on host H | app domain H, tagged | policy `decision: service_auth`, `include: [{service_token: <id resolved from env>}]` |

**Precedence:** CF Access matches the **most specific** application to a hostname, and within an app evaluates policies in order. A specific-host allow app (`dashboard...`) takes precedence over the wildcard floor app for that host. This is the mechanism that makes "default-deny floor + explicit allows above it" work. The plan's reconcile must create both the floor app AND the per-host apps; the per-host app is what actually lets the allowed principal in.

> **Verify-before-build (the ONE external assumption not verifiable from code, and it's load-bearing for the entire default-deny model):** confirm CF evaluates a `*.worldwidewebb.co` Block app + a `dashboard.worldwidewebb.co` Allow app so dashboard is allowed (specific app wins) while every other subdomain is blocked. Documented CF behavior (most-specific-app match), but MUST be confirmed against a live app pair in rollout step 2/3 before the dashboard cutover.

**Named fallback alternative (if precedence does NOT hold) — and its consequence:** create an **explicit per-host Block app for every host that should be denied**, instead of relying on a wildcard floor. This is deterministic but is a **real downgrade of the invariant Calum asked for**: it means a brand-new subdomain or an accidental new public route is **NOT auto-denied** — it's reachable until someone remembers to add a Block app for it. That breaks "default should be locked down." So this fallback is a last resort, and if precedence fails, **Calum must be told the invariant degrades** before proceeding (it's a product decision, not a silent implementation swap). Mitigation under the fallback: a CI/lint check that every `route:` host has either an allow or an explicit block app, so a new route can't ship ungated — but that guards declared routes only, not arbitrary wildcard hostnames, so it's strictly weaker than the edge wildcard floor.

---

## 4. Secrets & 1Password

Client **secrets** are secret; client **ids** are not. Both service tokens (kiosk + CI) need their secret stored in 1Password (Homelab) and referenced via `fromOp`; their ids can ride env via the existing CF_* docker-secret channel (non-secret, but uses the same plumbing to avoid hardcoding in this public repo).

New 1Password items (Homelab vault):

- **`CF Access Kiosk Token`** — fields: `client_id`, `client_secret`. Used by the iPad kiosk.
- **`CF Access CI Token`** — fields: `client_id`, `client_secret`. Used by GitHub Actions → `hooks`.

**Who creates the tokens?** Two viable approaches:

- **(a) bosun creates them** during `reconcileAccess` (create-if-missing) and the client_secret is captured once. Problem: the secret is returned once by the API and must be persisted to 1Password — bosun-agent does not write to 1Password, and capturing a one-time secret inside an advisory reconcile is fragile (if the write is missed, the token is unrecoverable and must be rotated). **Rejected for the secret-bearing path.**
- **(b) Tokens are created once by a human-run interactive save script** (`scripts/save-cf-access-tokens.sh`) that calls the CF API to create both service tokens and writes id+secret into the two 1Password items, then reconcileAccess only **references** them (binds the client_id into the floor's allow policies). **Recommended** — matches the repo convention ("new secret ships with an interactive `scripts/save-<thing>.sh`", per CLAUDE.md + the `using-1password` skill) and keeps the one-time-secret capture in a deliberate, re-runnable human step.

Under (b), `reconcileAccess` is purely declarative against tokens that already exist: it looks up the service token by name (`bosun-kiosk`, `bosun-ci`) to get its CF token **id** (the stable internal id, distinct from client_id) and references it in the `service_token` include rule. The save script is the only thing that ever sees a client_secret. This name→id lookup means the `CloudflareAccessClient` interface MUST include a **`listServiceTokens()`** method (a `GET /accounts/{id}/access/service_tokens` call in the live client; the fake returns a fixed list in tests), and the reconcile-time CF API token needs **Access: Service Tokens — Read** scope (see §7). The `include` rule references the **token id**, never the client_id or secret.

**Three distinct auth flows — do not conflate (the cookie is browser-only):**
- **Kiosk / WKWebView (browser):** headers on the initial nav → CF sets a `CF_Authorization` cookie carried on subsequent subresource requests. (But the watchdog's own probe/reload can't rely on that cookie — see §5.)
- **CI deploy webhook (curl, server-to-server):** a single stateless `POST`. CF service-token auth is **pure per-request header auth** — the two `CF-Access-*` headers on the POST authenticate THAT request directly. curl is one-shot and stateless, so there is **NO cookie round-trip and none needed**. §2's "CF mints a cookie for subsequent requests" is the browser story only; for CI it's headers-on-every-request, full stop.
- **reconcile (bosun → CF API):** plain bearer `Authorization` with the CF API token, like routes/DNS today. Unrelated to service tokens.

New env wiring for bosun-agent (`deploy.config.ts`, the existing CF_* secret block):

- `CF_ACCESS_KIOSK_CLIENT_ID` ← `op://Homelab/CF Access Kiosk Token/client_id`
- `CF_ACCESS_CI_CLIENT_ID` ← `op://Homelab/CF Access CI Token/client_id`

(Client ids are non-secret but ride the docker-secret channel like CF_ACCOUNT_ID etc. — same rationale: keeps them out of the public repo source. Add both names to the entrypoint export loop in `packages/bosun/docker-entrypoint.sh`.)

The CF **API token** itself (for managing Access) is resolved at reconcile time via `op://Homelab/Cloudflare API/credential` — same as routes/DNS today. **See Prerequisites (§7) for the scope problem.**

`scripts/save-cf-access-tokens.sh` — interactive, idempotent: checks if the 1Password items exist; if not, calls `POST /accounts/{id}/access/service_tokens` for `bosun-kiosk` and `bosun-ci`, captures the one-time client_secret, writes id+secret to the two items. Follows the `using-1password` save-script pattern (invalidate the op cache after write). Documented in the runbook.

---

## 5. Kiosk changes (iOS shell)

The iPad runs unattended, so it authenticates to `dashboard` with the kiosk service token, no human. Mechanism: send `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers on the **initial** WKWebView navigation; CF then sets a `CF_Authorization` cookie the webview carries on subsequent XHR/subresource requests within that load. (Caveat: the watchdog's own `URLRequest` probe + reload do NOT reliably share that cookie jar across session expiry, so they must send the headers directly — see the KioskWatchdog interaction below.)

**Capacitor 8 supports `server.headers`** (`apps/web/capacitor.config.ts`) — a map of headers injected on the WKWebView server-URL load. This is the clean, supported path (no Swift navigation-delegate surgery). **Omit the headers entirely when the env is unset** — do NOT send empty-string header values (an empty `CF-Access-Client-Id:` can be rejected/logged oddly by CF, and "no Access app yet" must be byte-identical to today):

```ts
const kioskAccess =
  process.env.CF_ACCESS_KIOSK_CLIENT_ID && process.env.CF_ACCESS_KIOSK_CLIENT_SECRET
    ? {
        "CF-Access-Client-Id": process.env.CF_ACCESS_KIOSK_CLIENT_ID,
        "CF-Access-Client-Secret": process.env.CF_ACCESS_KIOSK_CLIENT_SECRET,
      }
    : undefined;

server: {
  url: serverUrl,
  // ...
  ...(kioskAccess ? { headers: kioskAccess } : {}),
},
```

> Verify-before-build: confirm Capacitor 8 honors `server.headers` for the WKWebView remote-URL load on iOS, and that the resulting `CF_Authorization` cookie persists across the WKWebView's cookie store for subresources. If `server.headers` does not apply to the remote `server.url` load (only to local server), fall back to a custom WKNavigationDelegate that injects headers on the initial `URLRequest` (a small, contained change in `KioskViewController` / a Capacitor plugin). Decide this in the kiosk build unit, not at cutover.

**Build-time secret injection.** The client id+secret must reach the iOS build. They are NOT committed (public repo). `ios-build.yml` already sources secrets from 1Password into the GitHub Actions environment. Add two repo secrets `CF_ACCESS_KIOSK_CLIENT_ID` / `CF_ACCESS_KIOSK_CLIENT_SECRET` (from the `CF Access Kiosk Token` 1Password item) and pass them as env into the `bunx cap sync ios` step so `capacitor.config.ts` reads them. The compiled values land in the app bundle (acceptable: a TestFlight build is not a public artifact, and the token only grants dashboard read — same trust level as baking it into the kiosk).

**KioskWatchdog interaction (CRITICAL — exact failure mechanism, verified against the Swift).** The self-recovery watchdog was built assuming an OPEN origin (www-bwoy). The precise brick path once `dashboard` is gated and the WKWebView's `CF_Authorization` cookie has expired (read against `KioskHealth.swift` + `KioskWatchdog.swift`):

1. Cookie expired → the loaded document is the **CF Access login interstitial**, NOT a CF *error* page.
2. `KioskHealth.looksLikeCloudflareError` (`KioskHealth.swift:43-47`) only matches CF *error* markers (`error 1033`, `error 520-530`, `cf-error-*`, "web server is down"). The Access login page contains NONE of these → `cfError = false`.
3. The login page has no React `#root` → `hasRoot = false` → after `blankSamplesBeforeReload` (=2) samples, `broken = true` (`KioskWatchdog.swift:127`).
4. `evaluate()` → `probeOriginThenReload()` → the probe is a **bare `URLRequest` with no Access headers** (`KioskWatchdog.swift:137-140`). CF responds **302 → the Access login** (or 403).
5. **`KioskHealth.isHealthy(httpStatus:)` is `status >= 200 && status < 500` (`KioskHealth.swift:18-20`) — so a 302 is classified HEALTHY, not down.** (My earlier draft had this backwards.)
6. `isHealthy = true` → `reloadDashboard()` (`KioskWatchdog.swift:160-168`) does `webView.load(URLRequest(url: originURL))` again with **no Access headers** → the login page reloads → back to step 2.

Result: a **tight, permanent reload loop** (~the heartbeat interval + the 3s grace), the panel never self-recovers, only a manual login/force-quit fixes it. The loop is driven by the periodic DOM-sniff + reload, not just a cold start. This is strictly worse than "reads as unhealthy" — it's a healthy-looking 302 that re-renders the wall it can't pass.

Required kiosk-side fixes (mandatory, part of the kiosk build unit — NOT optional):
1. **The probe `URLRequest` must carry the CF-Access headers** (`probeOriginThenReload`) so it authenticates through the gate instead of bouncing to the 302 login.
2. **`reloadDashboard()` must re-inject the CF-Access headers** on its `webView.load(URLRequest)` so a session-expiry reload re-authenticates rather than re-rendering the login wall.
3. **`KioskHealth` needs a NEW positive signal: "this document is the CF Access login interstitial"** — sniff for the Access login markers / a `*.cloudflareaccess.com` redirect — classified as a THIRD state distinct from both "healthy" and "CF error": **"session expired → re-navigate WITH headers."** Without this new state the watchdog cannot tell a gated-but-up origin from a real one.
4. `KioskHealthTests.swift` (run by `scripts/test-kiosk-health.sh`, a fail-fast gate in `ios-build.yml`) must assert the REAL states: (a) the login-loop reproduces with header-less reload (regression guard), (b) headers on probe+reload produce an authenticated load, (c) the new login-interstitial classification fires on the Access page and NOT on the real dashboard or a CF error page.

Note on the cookie (corrects §2's phrasing): the `CF_Authorization` cookie is the BROWSER/WKWebView story — WKWebView carries it on subsequent subresource/XHR requests so only the initial nav needs headers. The watchdog's `URLRequest` probe and `reloadDashboard` are NOT guaranteed to share that cookie jar reliably across expiry, which is exactly why they must send the headers directly. The CI/curl path (§4) is different again — pure per-request header auth, no cookie (see §4).

---

## 6. Rollout & safety ordering (MOST IMPORTANT)

The dangerous moves are (a) enabling the wildcard `Block` floor and (b) putting an Access app on `dashboard` — because the instant either covers `dashboard`, the live wall panel needs the kiosk token, which it only has AFTER the iOS shell is rebuilt, shipped via TestFlight, and installed on the iPad. **That cannot complete in this work session.** The ordering below guarantees the live wall panel and CI auto-deploy are NEVER bricked.

**Build-safe-now invariant:** the bosun machinery + spec field + `reconcileAccess` + helper builders + tests + docs + kiosk code + the save-script are ALL inert until `access:` / `accessFloor()` declarations exist in `deploy.config.ts` AND tokens are wired. So everything can be built, tested, committed, and even deployed with NO declarations present and nothing changes at the edge. The cutover is purely "add the declarations, in this order."

### Step 0 — Prerequisite gate (human, blocking)
Confirm the CF API token has Access scopes (§7). If not, expand/replace it FIRST. **Brick risk:** none (read-only check). But every later step that calls the Access API fails without it.

### Step 1 — Build the machinery (safe, no edge change)
Ship: `spec.ts` field + builders, `reconcile/access.ts`, CLI wiring (advisory-guarded), `docker-entrypoint.sh` export additions, kiosk `capacitor.config.ts` + watchdog changes, `scripts/save-cf-access-tokens.sh`, unit tests, docs. Deploy normally. **Brick risk:** zero — no `access:` declarations exist and `spec.accessFloor` is undefined, so `reconcileAccess` sees an empty desired set and prunes nothing (its prune is tag-scoped; no bosun-tagged apps exist yet). The kiosk header config omits the headers when env is unset → identical to today (and no Access app covers dashboard yet anyway).

> **knip gate (WILL turn CI red if ignored).** The new exports — `AccessSpec`, `AccessRule`, `accessEmail`, `accessServiceToken`, `accessFloor`, `reconcileAccess`, `makeDefaultCloudflareAccessClient`, `stackAccessTag` — land in units 1–2 but their `deploy.config.ts` consumer doesn't land until units 8–9. Between those, knip (zero-tolerance, pre-push + CI `test` job; `deploy` needs `test`) flags them as dead exports and **blocks the deploy of units 1–7.** Fix: tag each with `/** @public — bosun access-gate spec surface, consumed by deploy.config.ts at cutover (www-cuuw) */` (knip honors `@public`), exactly as `ScheduleSpec` does today (`spec.ts:11`). Remove the tags later if/when a real consumer makes them redundant. This is not optional — it is a required part of units 1–2.

> Adversarial check the reviewer must confirm: with an EMPTY declared set, does `reconcileAccess` prune any pre-existing tag-owned app? It must not delete anything when nothing is declared AND nothing is tagged. (Same property routes.ts has: empty declared + a tag-owned route → prune; empty declared + no tag-owned → no-op. Here there are no tagged apps at step 1, so no-op. This must be explicitly tested.)

### Step 2 — Create service tokens + verify precedence on a throwaway host (human + verify)
Run `scripts/save-cf-access-tokens.sh` to create `bosun-kiosk` + `bosun-ci` tokens into 1Password. Then **manually create a temporary Access app on a throwaway host** (e.g. a scratch subdomain) plus a wildcard Block app, and confirm the precedence behavior from §3 (specific allow wins over wildcard block; an undeclared host is blocked). Delete the scratch apps. **Brick risk:** none if the scratch host is not a live one. DO NOT put the wildcard Block app on the zone yet in a way that covers dashboard — if you create the wildcard Block here for testing, the scratch allow must be the only thing tested and the wildcard removed before step 3, OR test precedence with the wildcard scoped so dashboard has a live allow first. Safest: test precedence using `storybook` (step 3) as the first real allow before ever creating the floor.

### Step 3 — Apply Access to the human hosts: `storybook` + `drizzle` (low risk)
Add `accessEmail(...)` to `storybook` and `drizzle` in `deploy.config.ts`; deploy. `reconcileAccess` creates two allow apps. **Brick risk:** low — these are human-only hosts; worst case Calum has to do an email-OTP login. No unattended consumer. If the email policy is misconfigured, only Calum's own browsing breaks, instantly visible and reversible (remove the declaration, redeploy). This is the first real exercise of `reconcileAccess` against live CF.

### Step 4 — Apply Access to `hooks` with the CI token; verify auto-deploy still works (medium risk)
Add `accessServiceToken({clientIdEnv: "CF_ACCESS_CI_CLIENT_ID"})` to `bosun-agent`. **Before deploying this, wire the CI caller** — the deploy webhook is a stateless server-to-server curl (`.github/workflows/ci.yml:481-486`: `curl -fsSL -X POST -H "Authorization: Bearer $BOSUN_WEBHOOK_TOKEN" ... https://hooks.worldwidewebb.co/deploy/control-center`). Add two more `-H CF-Access-Client-Id: ...` / `-H CF-Access-Client-Secret: ...` flags (values from the `CF Access CI Token` 1Password item via repo secrets). **This is pure per-request header auth — curl is one-shot and stateless, so there is NO `CF_Authorization` cookie and none is needed** (the cookie is the browser story only; do not design the CI path around it). The headers on the single POST authenticate it directly. **Brick risk: auto-deploy.** If the Access app goes live on `hooks` before CI sends the token, every future deploy webhook is blocked at the edge and auto-deploy is dead. Mitigation/order WITHIN step 4: (i) add the CI headers to the workflow and merge; (ii) confirm a deploy still succeeds end-to-end (the existing `BOSUN_WEBHOOK_TOKEN` still gates at the app layer, so adding the headers is harmless before the Access app exists); (iii) ONLY THEN add the `access:` declaration to `bosun-agent` and deploy. Verify a subsequent push deploys cleanly. The existing `BOSUN_WEBHOOK_TOKEN` remains as belt-and-suspenders. Bonus safety: the bosun-agent advisory reconcile means even if `hooks` Access mis-fires, a manual `bosun up` on the box bypasses the edge entirely.

### Step 5 — Ship the kiosk iOS update to the iPad (human + iOS, OUT-OF-SESSION GATE)
Cut a TestFlight build (`ios-build.yml`) with the kiosk headers + watchdog changes; install on the iPad; confirm the wall panel loads against a **dashboard that is NOT yet gated** (the headers are simply ignored when no Access app covers dashboard, so this is a no-op visually but proves the build is on-device and the header plumbing compiles/ships). **Brick risk:** none to the live dashboard (still open). This step's COMPLETION is the gate for step 6. It is explicitly a human/iOS step that cannot finish in this session.

### Step 6 — Cutover: gate `dashboard` + enable the wildcard `Block` floor (LAST, gated on step 5)
ONLY after step 5 is confirmed on the physical iPad: add `accessServiceToken({clientIdEnv: "CF_ACCESS_KIOSK_CLIENT_ID"})` to `web` (dashboard) AND set `accessFloor: accessFloor()` on the stack-level `stack()` opts; deploy. **Brick risk: the live wall panel + the whole zone.** This is the irreversible-feeling flip. Pre-flight checklist before deploying step 6:
- iPad confirmed running the new kiosk build (step 5).
- Kiosk token's client_id wired into bosun-agent env (`CF_ACCESS_KIOSK_CLIENT_ID`) AND into the iOS build.
- Verified from an OFF-network device that `storybook`/`drizzle` correctly prompt for email and `hooks` deploys still work (steps 3–4 green).
After deploy: **verify from an off-network device** (the AC) — dashboard is unreachable without the token; the iPad still loads it unattended; reboot the iPad and confirm it self-loads. If the panel is dark, immediate rollback = remove `access:` from `web` + `accessFloor()`, redeploy (the advisory reconcile + manual `bosun up` path means you can always redeploy from the box). Keep the rollback one-liner in the runbook.

**Treat step 6 as a documented manual cutover, NOT an autonomous flip.** This session builds through step 4 (machinery + human hosts + hooks) at most; steps 5–6 are handed off with the exact checklist above. The default-deny floor goes live LAST, only once the kiosk can authenticate.

---

## 7. Prerequisites (flag clearly — likely human-blocking)

**CF API token scope.** The existing `op://Homelab/Cloudflare API/credential` token is almost certainly scoped only to **Tunnel + DNS edit** (that's all routes.ts/DNS reconcile needed). Managing Access requires additional scopes:
- **reconcile-time token (bosun, runs every deploy):** Access: Apps and Policies — **Edit** + Access: Service Tokens — **Read** (the `listServiceTokens()` name→id lookup). It never creates/deletes tokens, so it does NOT need Service Tokens Edit.
- **save-script token (human, one-time):** Access: Service Tokens — **Edit** (to `POST` the two tokens). This can be the same token if you grant it both, or a separate short-lived one used only by the script.

**Action required (human, blocking step 0):** verify the token's scopes in the Cloudflare dashboard (My Profile → API Tokens, or `GET /user/tokens/{id}`). If it lacks Access scopes, either expand it or mint a dedicated Access-management token and store it (reuse the same item or a new `Cloudflare Access API` item). Do NOT assume the current token works — the first `reconcileAccess` call will 403 if it doesn't. The plan must not proceed past step 1's live test without this confirmed.

Also required: **Cloudflare Zero Trust must be enabled on the account** (a one-time, free, human dashboard step — set a team name / `*.cloudflareaccess.com` org domain). Flag this; it's a prerequisite for ANY Access app to exist.

---

## 8. Testing strategy

- **`reconcile/access.ts` unit tests** — a **dedicated `packages/bosun/test/access.test.ts`** (reconcile.test.ts is already ~1095 lines; keep the Access suite separate for clarity), mirroring the `reconcile/routes — prune safety` block with a dependency-injected fake `CloudflareAccessClient`:
  - create a declared app when absent;
  - idempotent (declared app already present → no create);
  - **prune only tag-owned orphan apps; never a foreign (untagged / other-tag) app** — the core safety test, copied from routes;
  - **empty declared set + no tagged apps → no-op (no deletes)** — the step-1 safety property;
  - **empty declared set + a tag-owned app → prune** — symmetry with routes;
  - policy mapping: `accessEmail` → allow+email include; `accessServiceToken` → service_auth + token include (id resolved via `listServiceTokens()` by token NAME); `accessFloor` → block+everyone;
  - `listServiceTokens()` name→id resolution (fake returns a fixed list; an unknown token name is a clear error, not a silent skip);
  - service tokens are never deleted by reconcile.
- **`spec.ts` builder tests** (`packages/bosun/test/spec.test.ts`): `accessEmail`/`accessServiceToken`/`accessFloor` produce the right `AccessSpec`; a service with `access:` but no `route:` throws; `stack()` threads `accessFloor` onto `Spec` and an absent `accessFloor` leaves it `undefined` (the ship-now state).
- **Live `CloudflareAccessClient` shape test** (mirror the `live Cloudflare client` block in reconcile.test.ts): stub `fetch`, assert correct CF Access endpoints/methods/bodies for `listApps`/`createApp`/policy ops/`deleteApp`/`listServiceTokens`.
- **Kiosk:** extend `KioskHealthTests.swift` (run by `scripts/test-kiosk-health.sh`, a fail-fast gate in `ios-build.yml`) for the new states from §5: (a) the header-less reload **login-loop reproduces** (regression guard against shipping the bug), (b) the new **CF-Access-login-interstitial** classification fires on the Access login page and NOT on the real dashboard or a CF error page, (c) headers on probe+reload yield an authenticated load. Note `isHealthy` is `200-499`, so a 302 is "healthy" — the tests must assert the login-page classification, not a 302→unhealthy path.
- **Gates:** `bun run typecheck`, `bunx biome check .`, `bun run test` (vitest — never bare `bun test`), `bunx knip` (zero dead code — any new exported builder with no consumer yet needs a `/** @public */` tag or a real call site). Commit format `type(area/www-cuuw)`, e.g. `feat(bosun/www-cuuw): add reconcileAccess`.
- **No live-CF tests in CI** — all reconcile tests use injected fakes (the routes.ts contract). Live verification is the manual rollout steps (3/4/6), screenshotted/confirmed from an off-network device.

---

## 9. Work breakdown (discrete implementable units)

Each is a self-contained commit `type(area/www-cuuw): ...`. Units 1–6 are the safe-to-ship-now machinery; 7–9 are the gated rollout.

1. **spec field + builders** — `AccessSpec`, `AccessRule`, `access?` on `ServiceSpec`, **`accessFloor?` as an OPTIONAL field on `Spec` + `stack()` opts**, `accessEmail`/`accessServiceToken`/`accessFloor` helpers; **all new exports tagged `/** @public ... */`** (knip gate — see step 1); builder + validation tests (incl. `access:` without `route:` throws, `stack()` threads the optional floor). (`packages/bosun/src/spec.ts`)
2. **`reconcile/access.ts`** — `CloudflareAccessClient` interface (incl. **`listServiceTokens()`**), `reconcileAccess`, `makeDefaultCloudflareAccessClient` (live CF Access API), `stackAccessTag`; `@public` tags; dedicated `access.test.ts` prune-safety + policy-mapping + token-id-lookup suite.
3. **CLI wiring** — Access step in `reconcileCloudflare()` (advisory-guarded), reading per-host apps from `spec.services.filter(s => s.access)` AND the floor from `spec.accessFloor`; optional `bosun access sync` subcommand; reads `CF_ACCESS_*_CLIENT_ID` from env.
4. **bosun-agent env + entrypoint** — add `CF_ACCESS_KIOSK_CLIENT_ID` / `CF_ACCESS_CI_CLIENT_ID` to `deploy.config.ts` bosun-agent secrets and append both names to the `docker-entrypoint.sh` export loop (one-line change; the `[ -f ]` guard already handles absent files).
5. **`scripts/save-cf-access-tokens.sh`** — interactive token creation (`bosun-kiosk`, `bosun-ci`) → 1Password (Homelab), idempotent, op-cache-invalidating (per `using-1password`).
6. **kiosk shell** — `capacitor.config.ts` `server.headers` (omit when env unset, never empty strings); `KioskWatchdog` + `KioskHealth` taught about the Access gate per §5 (probe carries headers, `reloadDashboard` re-injects headers, NEW login-interstitial classification distinct from healthy/CF-error); `KioskHealthTests` for the three §5 states + the login-loop regression guard; `ios-build.yml` repo-secret wiring for the kiosk client id/secret.
7. **docs** — update `docs/deployment-design.md` + a runbook section (the access matrix, the save-script, the rollback one-liner, the rollout order, the CF token-scope + Zero-Trust-enable prerequisites). Per CLAUDE.md docs-discipline, ships in-band with the machinery.
8. **rollout: human hosts + hooks** (steps 3–4) — add `accessEmail` to storybook/drizzle; wire CI caller headers; then `accessServiceToken` on bosun-agent. Verified per step.
9. **cutover (handed off, gated on iOS)** — `accessServiceToken` on `web` + `accessFloor: accessFloor()` on the `stack()` opts, AFTER the iPad runs the new kiosk build. Documented checklist; not an autonomous step.

Units 1–7 are buildable and shippable in this session. Unit 8 is shippable once the CI-token verification (step 4) is done in-session if time allows. Unit 9 is explicitly out-of-session (the iOS/iPad gate).

---

## 10. Open questions / decisions

Resolved in review round 1 (reviewer confirmed): floor as optional stack-level field (§3); save-script token creation (§4); watchdog fix is mandatory with the corrected login-loop mechanism (§5); CI = stateless per-request header auth, no cookie (§4); knip `@public` tags required (step 1 / §8); `listServiceTokens()` in the client interface (§2/§4); precedence fallback consequence named (§3); CF token scopes split reconcile-Read vs script-Edit (§7).

Remaining, needing live confirmation before/at build (not blockers to start):
1. **Capacitor 8 `server.headers` on the REMOTE `server.url`** — confirm it applies to the remote load on iOS (docs are ambiguous about remote vs local server). Fallback: a WKNavigationDelegate injecting headers on the initial `URLRequest` in `KioskViewController`. Accepted as in-scope fallback for the kiosk unit if needed.
2. **CF most-specific-app precedence** (wildcard Block + specific Allow) — confirm live in rollout step 2/3 before the dashboard cutover. If it fails, §3's named fallback applies AND Calum must be told the default-deny invariant degrades (a product decision, not a silent swap).
