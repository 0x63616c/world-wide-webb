# Captive-portal E2E harness (www-q002.16)

Status: **PREP**. The harness (Playwright config + smoke spec) is in place and runs
against the current placeholder app. The full journey matrix is **blocked on the
screens (www-q002.6) and state machine (www-q002.7)**. It activates once those land.

## Run it

```bash
# from apps/captive-portal
bun run e2e          # headless, starts the Vite dev server on :4205 itself
bun run e2e:ui       # Playwright UI mode for authoring
```

Point at an already-running server (skip the managed dev server):
`PORTAL_E2E_BASE_URL=http://127.0.0.1:4205 bun run e2e`.

## RAM discipline (the 32GB no-cgroups rule)

`playwright.config.ts` pins **chromium only**, **`workers: 1`**, **`fullyParallel:
false`**. A captive-portal flow is sequential per device, and a single Chromium is
~1.5GB; fanning out one browser per core would blow the box. This mirrors the web
repo's serial Storybook browser project. Do NOT raise `workers` for this suite.

## Mock seams the flow specs will use (so no real email / UniFi / MAC)

The backend already ships the seams; the flow specs wire them like this:

1. **OTP readback (no real inbox).** In dev/test the portal router uses the MOCK
   email sender (`apps/api/src/services/portal-mock-sender.ts`), which logs the
   code AND stores the last code per email. The flow spec reads it back instead of
   checking an inbox. Two viable readback paths, to be chosen when the screens land:
   - a tiny **dev-only** tRPC/HTTP route exposing `mockSender.lastCode(email)`,
     mounted only when `NODE_ENV !== "production"` (never shipped to prod); or
   - parse the structured log line `"portal MOCK email, verification code"`
     (it carries `{ email, code }`) from the api dev process.
   Recommendation: the dev-only route, deterministic, no log scraping.

2. **Fake MAC injection.** UniFi redirects a real guest with `?id=<mac>&ap=…&ssid=…`.
   The spec drives the same entry by navigating with a synthetic MAC query param
   (e.g. `?id=AA:BB:CC:DD:EE:FF`). The state machine (www-q002.7) reads the MAC from
   the URL/sessionStorage; the spec just supplies it. No real device needed.

3. **UniFi authorize is mocked end-to-end already.** The portal service calls the
   `UnifiGuestClient` interface; in dev/test it's never the real controller. The
   E2E asserts the *UX* (Success screen, redirect intent), not a real grant. The
   authorize→43200 contract is unit-tested in `apps/api` (unifi-guest.test.ts).

4. **Clock / cooldown.** The 30s resend cooldown + 10-min code TTL are real
   server timers. The resend-cooldown spec asserts the button is disabled then
   re-enabled; the expiry spec will need either a test-only short TTL env knob or
   Playwright's clock API on the client countdown. Decide when the screen exists.

## Full matrix to implement once .6/.7 land (PRD Testing §3)

happy path · every validation error (name/email/format/terms) · wrong-code ×3 →
RateLimited · wrong-password ×3 → RateLimited · expired-code → resend · network
failure · refresh persistence (sessionStorage restores step+email) · already-online
(active authorization → AlreadyConnected) · SessionExpired (lapsed >30d) · Terms
round-trip (returns without losing form state) · mobile viewport · keyboard-only +
reduced-motion.

## CI wiring plan (to add to .github/workflows/ci.yml when un-blocked)

- A new job `e2e-captive-portal`, `needs: [changes]`, gated on the existing
  **`captiveportal`** path-filter output (already defined in the `changes` job).
- Steps: checkout → `oven-sh/setup-bun` → `bun install --frozen-lockfile` →
  `bunx playwright install --with-deps chromium` (chromium only, the test job
  already does this for Storybook, so the layer is warm) → `bun run --filter
  @cc/captive-portal e2e`. Playwright's `webServer` starts the Vite server; no
  separate api is needed for the smoke spec. The flow specs additionally need the
  api + postgres, bring them up with the same compose the unit-integration path
  uses, OR run the portal router in-process behind the dev server (decide with
  the screens).
- Make **`deploy` depend on this job** (same pattern as `test`) so a red E2E
  blocks the prod roll, but ONLY after the flow specs exist; while it's a single
  smoke spec, keep it advisory (not a deploy gate) to avoid a hollow gate.
- Serial + chromium-only keeps it within the runner's memory; `retries: 1` on CI
  absorbs the occasional cold-start flake.
