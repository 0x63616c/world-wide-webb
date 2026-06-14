# Captive Portal PRD, guest WiFi onboarding (www-q002)

One line: a UniFi external captive portal at `captive-portal.worldwidewebb.co` (LAN-only) where a guest verifies their email with a 6-digit code, enters the WiFi password, and gets 30 days of internet per device. Design is 1:1 from `docs/captive-portal/design/`.

**Goals**

1. Every screen and state from the design implemented, reachable, and tested.
2. A guest completes the happy path and actually gets internet via UniFi `authorize-guest`.
3. Every error/recovery path behaves exactly as designed, no dead ends.
4. Unit + integration + E2E coverage, all green in CI; red blocks deploy.
5. Works in mobile and desktop captive webviews, WCAG AA, refresh-safe, double-submit-safe.
6. Deployed to production on homelab via Pulumi/k3s, reachable only from the local network.

**Non-goals**

1. No admin UI (v1).
2. No bandwidth/data caps on authorizations (v1).
3. No new repo, no PRs; everything lands in control-center on `main`.

**Source of truth**

1. Design assets: `docs/captive-portal/design/` (tokens `theme.css`/`ds.css`, primitives `components.jsx` + `ds-components.jsx`, screens `screens.jsx`, state machine `World-Wide-Webb Portal.html` + `ds-flow.jsx`, visual reference `Handoff Canvas.html` + `screenshots/`, brief `Implementation Brief.md`).
2. Precedence: this PRD > Implementation Brief where they conflict (the brief predates Calum's overrides, see Decisions).
3. Shipped landing variant: `LandingBare`. `LandingCentered`/`LandingSplit` exist as stories only.

**Screens and states**

1. Landing (`LandingBare`): empty, filled/valid, per-field errors (name required, email required, email format, terms unticked), submitting.
2. Sending code: transient loading.
3. Verify email: awaiting, partial, complete, wrong code, expired code, resend cooldown (30s), resend available, code-resent confirmation.
4. WiFi password: awaiting, filled, show/hide, wrong password, network failure.
5. Connecting: stepped status.
6. Success: white check, "browser should redirect" line, start browsing.
7. AlreadyConnected: returning device with a live authorization.
8. RateLimited: too many attempts, countdown.
9. SessionExpired: 30-day lapse.
10. GenericError: anything unexpected.
11. Terms: linked from checkbox + footer, returns without losing form state.

**Flow rules**

1. Validate on submit; a field error clears on first edit of that field.
2. 3 wrong codes OR 3 wrong passwords → RateLimited; counters reset on success/back/resend.
3. Codes expire after 10 minutes; expiry is a distinct path from wrong code.
4. Resend cooldown 30 seconds, server-enforced.
5. Authorization lifetime: 30 days per device (43200 minutes).
6. Submit locks while in flight; the authorize step is idempotent.
7. Step + email persist in sessionStorage; mid-flow refresh restores position.
8. Exact copy deck; no em dashes; SSID name and the word "guest" never appear in user-facing copy.

**Frontend (`products/captive-portal/apps/frontend`)**

1. Vite + React 19 + TypeScript + Tailwind v4 + shadcn/ui, homogenous with `products/control-center/web`.
2. OTP input built on shadcn `input-otp` (auto-advance, paste, backspace, numeric-only, `autocomplete="one-time-code"`).
3. Geist + Geist Mono self-hosted (captive webviews block CDNs).
4. Pure `#000` background, hairline borders, state color only for error/success.
5. State machine is a pure UI-free module with table-driven transition tests.
6. tRPC client to the portal router only; the frontend never talks to UniFi.
7. A11y: labels tied to inputs, `role="alert"`, `aria-invalid`/`aria-describedby`, focus rings, ≥44px targets.
8. Own Storybook, composed (refs) into the web host Storybook as a separate sidebar section. Blocking gate: screens work (www-q002.6) starts only once the component library is browsable in the composed host (www-q002.5).

**Backend (`products/captive-portal/apps/api`)**

1. Product-owned tRPC `portal` router boundary: `sendCode`, `verifyCode`, `checkPassword`, `authorize`, `status`, `resetAttempts`.
2. UniFi never calls us; it redirects the guest's browser with query params (`mac`/`id`, `ap`, `ssid`, `t`, `url`), the MAC is carried through the whole flow.
3. `EmailSender` interface: mock impl logs via `@repo/logger` AND stores the code (dev-readable, Calum's "print the 6 thing"); Resend impl behind the same interface once creds land (`scripts/save-resend.sh`).
4. WiFi password check compares against the op-delivered `WIFI_PASSWORD` secret (item `WiFi Guest Credentials`, set via `scripts/save-wifi-guest.sh`).
5. `UniFiClient` interface: authorize-guest (mac, minutes=43200), active/lapsed authorization lookup; UniFi OS `/proxy/network` path handling; mocked in all tests.
6. Rate limits and cooldowns enforced server-side; services THROW on error/unconfigured (house rule).
7. Recurring cleanup (expired codes/counters) via a k8s `CronJob` (`infra/src/crons.ts`), not a worker loop.

**Data model (Postgres, drizzle, migrate-on-boot)**

1. `portal_guest` (`gst_` ids): name, email.
2. `portal_code` (`otp_` ids): 6-digit code, guest ref, expiry, consumed flag.
3. `portal_attempt`: per-flow wrong-code/wrong-password counters + rate-limit window.
4. `portal_authorization`: device MAC, guest ref, granted/expires timestamps (UTC), 30-day window.

**UniFi integration**

1. Controller: UniFi OS on the Cloud Gateway Fiber at `https://192.168.0.1`; version/API shape verified live before coding (read-only probe).
2. Auth: `op://Homelab/UniFi/local_api_key` (X-API-KEY; read-write incl. private `set/setting` API).
3. Guest WLAN `www-guest` with external portal pointed at `https://captive-portal.worldwidewebb.co`; walled garden allows the portal host pre-auth.
4. On success: `authorize-guest` for the client MAC, 43200 minutes; then browser redirect to the original `url`.
5. Returning device with live authorization → AlreadyConnected; lapsed >30 days → SessionExpired.
6. All UniFi setup done programmatically via the API where possible; every setting recorded in `docs/captive-portal/runbook.md`.

**Networking and deploy**

1. Own image `control-center-captive-portal` (nginx static), CI build job + path filter + digest map, same pattern as the worker.
2. k8s `Service type: LoadBalancer` (republished on the mini's LAN NIC by OrbStack `expose_services`) and NO tunnel ingress, the portal must never be reachable through cloudflared.
3. LAN-only via split-horizon DNS: UniFi local DNS record `captive-portal.worldwidewebb.co → Mini LAN IP`; the public wildcard resolves to Cloudflare which has no route (dead end).
4. TLS: Let's Encrypt via Cloudflare DNS-01, issued/renewed by cert-manager, the cert mounted into the portal nginx.
5. nginx proxies ONLY `/api/trpc/portal.*`; every other path 404s, guests can never reach dashboard procedures (lights/climate/Sonos). During the M5 cutover window the proxy can still target the previous Control Center API-backed route for rollback.

**Security**

1. Guests are untrusted: the scoped proxy allowlist is the boundary between the guest VLAN and the dashboard api.
2. All secrets in 1Password via op (`UniFi`, `WiFi Guest Credentials`, `Resend`, `Cloudflare API`); nothing in the repo or frontend bundle.
3. HTTPS end-to-end on the open guest WLAN; gitleaks/no-address guards apply to all committed assets.
4. Related but out of scope here: www-cuuw (P0), the public dashboard has no auth gate; handled in a separate thread.

**Testing**

1. Unit: validation, OTP behavior, rate-limit counters, code generation/expiry, table-driven state machine.
2. Integration: router matrix (send/verify/check: correct, wrong, expired, lockout), UniFi authorize against mocked `UniFiClient` (assert mac + 43200, no network).
3. E2E (Playwright, CI-gated): happy path, every validation error, wrong-code ×3, wrong-password ×3, expired→resend, network failure, refresh persistence, already-online, Terms round-trip, mobile viewport, keyboard-only + reduced-motion.
4. Strict TDD throughout; `bun run test` (vitest) only, never bare `bun test`; E2E serial/RAM-capped per the 32GB rule.

**Runbook (deliverable: `docs/captive-portal/runbook.md`)**

1. Calum: run `scripts/save-wifi-guest.sh` (sets the WiFi password in 1P) and mirror that password on the guest WLAN.
2. Calum: run `scripts/save-resend.sh` when ready (mock sender covers dev until then).
3. Agent via UniFi API: create/configure `www-guest` WLAN, external portal URL, walled garden, local DNS record.
4. Anything the API won't expose becomes a documented human step with exact console clicks.
5. Cutover: real phone on the guest SSID, full flow with a real email, verify internet + redirect + 30-day row.

**Decisions (overrides of the Implementation Brief)**

1. Monorepo app in control-center, not a standalone server: frontend `products/captive-portal/apps/frontend`, product API boundary `products/captive-portal/apps/api`, deploy via Pulumi/k3s.
2. Postgres (existing) instead of Redis/in-memory TTL store.
3. Resend instead of generic SMTP; mocked (log + store the code) until creds land.
4. shadcn/ui on Tailwind v4 instead of hand-ported CSS primitives; design tokens still match `theme.css` 1:1.
5. Domain `captive-portal.worldwidewebb.co` (never `captive.`), LAN-only via split-horizon DNS + DNS-01 TLS.
6. Storybook: yes, composed into the existing host, and a blocking gate before screens (two reversals of the early "no storybook" call).
7. No PRs ever; worktrees merge to `main`; commit scope carries the `CC-` ticket id.

**Milestones and tickets (epic www-q002)**

1. M1 scaffold: www-q002.1 (app scaffold), www-q002.2 (CI image job).
2. M2 component library: www-q002.3 (tokens + fonts), www-q002.4 (primitives, TDD), www-q002.5 (Storybook composition).
3. M3 screens + flow: www-q002.6 (all screens/states), www-q002.7 (state machine + persistence).
4. M4 backend: www-q002.8 (schema), www-q002.9 (portal router), www-q002.10 (UniFiClient), www-q002.11 (Resend impl).
5. M5 deploy + network: www-q002.12 (bosun publishPort), www-q002.13 (DNS-01 TLS), www-q002.14 (LAN-only deploy + scoped proxy), www-q002.15 (UniFi setup + runbook).
6. M6 verification: www-q002.16 (Playwright E2E in CI), www-q002.17 (real-device production cutover).
