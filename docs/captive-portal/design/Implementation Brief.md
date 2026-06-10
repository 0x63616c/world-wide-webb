# /goal — Ship the "world-wide-webb" Wi-Fi captive portal

You are implementing a production captive portal for a home UniFi network. The complete
design, component spec, copy, and every screen state already exist in this project (see
**Design assets** below). Your job is to turn that design into a working, tested portal that
authorizes guests on the UniFi network after they verify their email and enter the Wi-Fi
password.

Work in **strict TDD**: write a failing test, make it pass, refactor. No feature is "done"
until it has tests and they're green. Do not skip the integration and end-to-end layers.

---

## Definition of done

1. Every screen and state from the design is implemented and reachable.
2. A guest can complete the full happy path and actually gets internet access via UniFi.
3. Every error/recovery path behaves exactly as specified, with no dead ends.
4. The whole thing is covered by unit, integration, and end-to-end tests, all passing in CI.
5. It runs on mobile and desktop captive webviews, is accessible (WCAG AA), and is
   refresh-safe and double-submit-safe.

---

## Design assets (read these first — they are the source of truth)

- `Design System.html` + `ds-foundations.jsx`, `ds-components.jsx`, `ds-flow.jsx`, `ds-kit.jsx`, `ds.css`
  — the written spec: tokens, every component with all states/props, the state machine,
  **validation rules**, the **copy deck**, accessibility checklist, and the edge-case matrix.
- `theme.css` — design tokens (color/type/spacing/radius) and the CSS for every component.
- `components.jsx` — React primitives: Button, Field, TextInput, CheckboxRow, Alert, OtpInput,
  NetworkPill, plus `validate()` and `validatePassword()`.
- `screens.jsx` — all screens (landing variants, Verify, WifiPassword, Connecting, Success,
  Sending, RateLimited, SessionExpired, GenericError, Terms). **The shipped landing is the
  `LandingBare` variant.**
- `World-Wide-Webb Portal.html` — the working flow/state-machine wiring (transitions, counters,
  timers, error handling) to mirror in the real app.
- `Handoff Canvas.html` — visual reference of every screen and state.

Match the design exactly: pure-black Vercel/shadcn theme, Geist + Geist Mono, white primary,
hairline borders, state color only for errors/success. Do not invent new UI.

---

## Scope — screens & features (build all of them)

**Happy path:** Landing (name + email + terms) → Sending code → Verify email (6-digit OTP) →
Wi-Fi password → Connecting → You're online.

**Screens/states (each must exist, be reachable, and be tested):**
- Landing: empty, filled/valid, field-validation errors (name required, email required,
  email format, terms unticked), submitting/loading.
- Sending code (transient loading).
- Verify email: awaiting, partial, complete, wrong code, expired code, resend cooldown (30s),
  resend available, "code resent" confirmation.
- Wi-Fi password: awaiting, filled (show/hide), wrong password, network failure.
- Connecting (stepped status), Success (white check + "browser should redirect" line + start browsing).
- Recovery: Too many attempts (rate-limit with countdown), Session expired (30-day lapse),
  Something went wrong (generic), Already online (returning live session).
- Terms of use page (linked from the checkbox and footer; returns without losing form state).

**Rules (from the spec, implement precisely):**
- Validate on submit, clear a field error as soon as it's edited.
- 3 wrong codes OR 3 wrong passwords → rate-limit screen; reset counters on success/back/resend.
- Codes expire (default 10 min) and are distinct from wrong codes.
- Access lifetime: **30 days per device**.
- Use the exact copy from the copy deck. No em dashes. Never reference the SSID name or the
  word "guest" in user-facing copy.

---

## Architecture

Build two pieces:

1. **Portal frontend** — the screens above as a single-page flow. Port `theme.css` /
   `components.jsx` / `screens.jsx` faithfully. Keep the state machine from
   `World-Wide-Webb Portal.html`. Persist the current step + email (e.g. sessionStorage) so a
   reload doesn't reset the guest.

2. **Portal backend (external portal server)** — handles the UniFi redirect, email code
   send/verify, the Wi-Fi password check, rate limiting, and the UniFi authorize call. Keep all
   secrets and the UniFi credentials server-side. The frontend never talks to UniFi directly.

Suggested stack (use your judgment / their existing stack if present): TypeScript, a small HTTP
server (Express/Fastify/Hono), a transactional email provider (or SMTP) for the codes, and a
short-lived store (Redis or in-memory with TTL) for codes, attempt counters, and rate limits.

---

## UniFi integration (the part that actually grants internet)

This is a UniFi **external captive portal**. Confirm specifics against the controller version in
use (UniFi OS console vs. classic Network controller) — APIs differ by version, so verify, don't
assume.

1. **Enable the external portal** on the guest WLAN's hotspot/guest-control settings and point
   the "external portal server" URL at this app. UniFi redirects connecting clients to that URL.
2. **Read the redirect parameters** UniFi appends (commonly `id`/`mac` = client MAC, `ap` = AP MAC,
   `ssid`, `t`, and the original `url`). Carry the client MAC through the whole flow.
3. **On success** (email verified + correct Wi-Fi password), the backend authorizes the client
   with the controller's guest-manager command, e.g.:
   - Authenticate to the controller (login endpoint / API key), then
   - `POST /api/s/<site>/cmd/stamgr` with `{ cmd: "authorize-guest", mac: <clientMac>, minutes: 43200 }`
     (43200 min = 30 days). Optionally pass bandwidth/data limits.
   - On UniFi OS, prefix controller API paths with `/proxy/network` and handle the CSRF/cookie flow.
4. **Redirect the guest** back to the original `url` (or a default page) once authorized — this is
   what the Success screen's "your browser should redirect automatically" copy refers to.
5. **Returning devices:** if the MAC already has an active authorization, short-circuit to the
   "Already online" screen; if a prior authorization has lapsed past 30 days, show "Session expired".

Wrap all UniFi calls behind a single `UniFiClient` interface so it can be **mocked in tests** and
swapped per controller version.

---

## TDD plan & good practices

**Write tests first at every layer:**

- **Unit** — validation (`validate`, `validatePassword`, email regex, password min-length),
  the OTP component behavior (auto-advance, paste, backspace, numeric-only), the rate-limit
  counter logic, code generation/expiry, and the state-machine transitions (table-driven:
  state + event → next state).
- **Integration** — backend routes: send-code, verify-code (correct / wrong / expired /
  lockout after 3), check-password (correct / wrong / lockout), and the UniFi authorize call
  against a **mocked** `UniFiClient` (assert MAC + 43200 minutes; assert no real network call).
- **End-to-end** (Playwright or similar) — drive the real UI through: full happy path; each
  validation error; wrong-code ×3 → rate limit; wrong-password ×3 → rate limit; expired code →
  resend; network failure → returns to password with alert; mid-flow refresh keeps state;
  already-online short-circuit. Include mobile viewport and a keyboard-only/`prefers-reduced-motion` pass.

**Practices:**
- Keep the `UniFiClient`, email sender, and code/rate-limit store behind interfaces; inject them.
- All secrets in env/config, never in the repo or the frontend.
- Lock the submit button on press; make each step idempotent to prevent double-authorization.
- Accessibility is a test target, not an afterthought: labels tied to inputs, `role="alert"`
  on errors, `aria-invalid`/`aria-describedby`, visible focus rings, ≥44px touch targets,
  `autocomplete="one-time-code"` on the OTP.
- Self-host the Geist fonts (captive webviews often block external CDNs).
- Set up CI to run lint + all test layers on every push; do not merge red.

---

## Suggested order of work

1. Scaffold the project + test harness; get one trivial test running in CI.
2. Port tokens + primitives (`theme.css`, `components.jsx`) with unit tests for validation/OTP.
3. Build the screens and the state machine (`screens.jsx` + flow), test transitions.
4. Backend: code send/verify + password check + rate limiting, with integration tests on mocks.
5. UniFi `UniFiClient` + authorize-on-success, tested against a mock; then a real staging device.
6. Wire frontend ↔ backend; add persistence and the returning-device checks.
7. Full E2E suite (happy + every unhappy path, mobile + a11y); harden; ship.

Start by reading the design assets, confirming the UniFi controller version, then write the
first failing test. Ask me before introducing any UI or copy that isn't already in the design.
