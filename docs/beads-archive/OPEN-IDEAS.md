# Beads Archive - Open Ideas

Snapshot of the **146 open** bd tickets at the time we dropped Beads (2026-07-11).
These are the unfinished ideas worth keeping. The full raw dump of all 800 issues + 50 memories (open **and** closed) lives in [`beads-export.jsonl`](./beads-export.jsonl).

Status counts at export: 146 open, 654 closed.

---

## uncategorized (69)

### `www-bfdk` - Purge personal email from git history (public repo)
_P0 · task_

Calum's personal iCloud login email was committed as a literal into docs/superpowers/specs/2026-06-10-cc-cuuw-access-gate-design.md and reached PUBLIC origin/main in commit history (CC-cuuw work, 2026-06-10). HEAD was scrubbed forward (commit 61b516b0 + the accessEmailEnv rework sources the email from 1Password instead), but the old commit still contains it. Do a proper history purge like the home-address incident (CC-3zi/CC-d3j): git filter-repo / BFG to strip the email from all commits, then force-push (coordinate - concurrent sessions push to main; touches dolt refs/dolt/data too). ALSO ROOT CAUSE: the no-personal-email pre-commit guard WORKS (verified it flags the exact lines) but was BYPASSED for that commit (--no-verify or hooks inactive in the worktree). Add a CI-side backstop so the guard can't be bypassed: a job in ci.yml that runs check-no-personal-email.sh over ALL tracked files on every push (deploy depends on it), mirroring the storybook-docs guard pattern - pre-commit alone is --no-verify-bypassable.

**Acceptance:**

- [ ] git history on origin/main contains NO occurrence of the personal email (git grep over all refs is clean)
- [ ] force-push coordinated; dolt refs/dolt/data intact; CI green after
- [ ] CI job added that runs check-no-personal-email.sh over all tracked files (non-bypassable backstop); deploy depends on it
- [ ] verified the new CI guard fails on a planted email and passes when clean


### `www-cuuw` - Dashboard web+api are publicly reachable with zero auth - decide and implement an access gate
_P0 · task_

Verified 2026-06-09: https://dashboard.worldwidewebb.co serves the full board publicly through the Cloudflare tunnel with no Cloudflare Access, no Tailscale, no app auth. The web nginx proxies /api to the tRPC api, whose procedures (lights, climate, Sonos, party mode) are unauthenticated - anyone with the URL can control the house. Storybook is also public (harmless-ish); drizzle gateway is masterpass-gated; hooks is token-gated. Options: Cloudflare Access with a service token baked into the iPad kiosk shell, mTLS, LAN-only split-horizon like the captive portal, or deliberate accept-risk. Found while planning the captive-portal epic.

**Acceptance:**

- [ ] Decision recorded (gate mechanism or explicit accept-risk) with Calum sign-off
- [ ] If gating: dashboard.worldwidewebb.co unreachable without the chosen credential, iPad kiosk still loads it unattended (survives reboot), verified from an off-network device
- [ ] docs updated (deployment docs + runbook)


### `www-gpch` - Add deterministic iPad/Captive Portal native run flow
_P0 · task_

Why this exists: Text Your Ex now needs a deterministic one-click physical-device loop from Tilt, and the same pattern should exist for the iPad/Captive Portal native app instead of relying on hidden Xcode local state. Calum can plug in the iPad for proof.

What to do:
- Locate the iPad/Captive Portal native app project and Capacitor/native config.
- Commit signing defaults in the project file where appropriate, including Apple team X9E4HG27NK, instead of relying on ad-hoc Xcode UI state.
- Add a versioned script that builds, verifies live-reload config, verifies entitlements/signing, installs to the physical iPad, and launches the app.
- Add a manual Tilt button for the physical iPad run flow.
- Keep device IDs and server URL overridable via environment variables.
- Prove the flow with the plugged-in iPad and record the exact command/output in the issue notes.

Acceptance criteria:
- [ ] Captive Portal/iPad native project path is identified and documented in the issue notes.
- [ ] Native project has deterministic committed signing defaults, not hidden local Xcode state.
- [ ] Tilt exposes a manual physical iPad run button.
- [ ] Script builds, verifies config/signing, installs, and launches on the plugged-in iPad.
- [ ] Local run uses live reload against the correct local dev server.
- [ ] Typecheck and relevant focused gates pass.


### `www-ljoq` - DECIDE: CI build/deploy can silently ship a stale image (path-filter gap) - pick the fix
_P0 · decision_

**Acceptance:**

- [ ] Decision recorded: which approach (A last-deployed-SHA base / B source-hash image identity / C build-all) we adopt, with rationale
- [ ] Decision applies UNIFORMLY across all images (cc web/api/worker/media-worker/storybook/drizzle, captive-portal, amp, map-provision, tye-api/tye-frontend)
- [ ] Invariant stated: deployed image for each service == image built from that service's CURRENT main source
- [ ] Follow-up implementation ticket(s) filed + linked to enact the chosen option
- [ ] www-ukat reconciled (this supersedes/absorbs it or is linked)


### `www-llf` - Polish snap-to-center per-card animation feel
_P0 · feature_

The snap-to-middle navigation does not feel right. Two problems: (1) when the viewport settles between two cards it can rest in the gap instead of committing to a card; it should always pick a single card to settle on. (2) general feel is not perfect. Improve the settle so it deterministically chooses the nearest card center (even from a gap, pick nearest target rather than bailing) and tune SNAP_SMOOTH_TIME / deadzone for a crisper dock. See onSettle/springTo/smoothDamp in Board.tsx.

**Acceptance:**

- [ ] Settling between two cards always commits to exactly one card center (never rests in a gap).
- [ ] onSettle picks the nearest CENTER_TARGET when the viewport center is in a gap, instead of returning early.
- [ ] Snap feel tuned and verified on-device feel (subjective, Calum sign-off).
- [ ] bun run test + typecheck green.


### `www-qbw8` - Fix /goal: goal text is not injected into assistant context
_P0 · bug_

**Acceptance:**

1. Plugin injects goal text into assistant's system prompt/context so the agent can see the active goal. 2. /goal set, /goal status, /goal clear work. 3. Goal is re-injected on each assistant turn (or once per session, whichever keeps it visible). 4. No fake/placeholder data; no secrets in logs. 5. bun run test && bunx biome check . green.


### `www-s8y1` - P0 captive-portal bypass cleanup and deeper audit
_P0 · task_

Goal: remove temporary test/test-scope skips and tighten bypass exceptions while preserving only justified production-grade suppressions.

Context:
- Captive-portal E2E has 9 flow journey skips in apps/captive-portal/e2e/flow-matrix.spec.ts and one seeded refresh skip in apps/captive-portal/e2e/refresh-persistence.spec.ts that are currently tied to CC-q002.19.
- A deeper sweep is needed across test-time bypasses and lint suppressions to separate hard blockers from refactor debt.
- The cleanup is P0 because these are critical journey coverage gaps for portal onboarding and reliability.

Scope:
1) Captive-portal E2E unblock audit
   - Confirm each skip in flow-matrix.spec.ts and refresh-persistence.spec.ts is blocked by CC-q002.19.
   - Once CC-q002.19 lands, remove skips and run the full journey tests as live E2E assertions.
   - Validate flows using the mock sender code path and real effect runner, covering happy path, wrong-code retries/rate limit, wrong-password retries/rate limit, expired code, resend cooldown, network failures, already-online, session-expired, terms return, and resetAttempts.

2) P0-level bypass hardening (beyond captive-portal)
   - Recount all repo test skip and lint suppression markers.
   - For each marker, confirm explicit ownership and reason:
     - hard dependency blocker (for example CC-q002.19)
     - intentional generated or framework-owned exception
     - temporary dev-only scaffolding
     - removable debt
   - Remove or convert any suppression that is no longer justified.

3) Regression protection
   - Keep remaining intentional suppressions documented with exact rationale and blocker IDs.
   - Ensure each temporary case gets either an unskip date or a follow-up ticket.

Blocking note:
- Journey skips are directly blocked by CC-q002.19 tRPC/effect-runner integration and should not be force-enabled before that work is complete.

Runbook impact:
- Update docs to reflect expected unskip conditions and real execution path in apps/captive-portal/e2e/README.md.

**Acceptance:**

Acceptance Criteria:
- The skip count in apps/captive-portal/e2e/flow-matrix.spec.ts is reduced to zero once CC-q002.19 is merged.
- The seeded refresh skip in apps/captive-portal/e2e/refresh-persistence.spec.ts is removed and the test validates real mid-flow refresh with live sendCode/verify/password path.
- Flow specs execute the journey matrix listed in apps/captive-portal/e2e/README.md, with OTP read from a mock sender or equivalent test-only deterministic path, not ad-hoc hand-seeded session-only shortcuts.
- A bypass audit summary is recorded in ticket notes with every test skip/skip directive and biome-ignore marker classified as required, temporary, or removable.
- Any remaining temporary suppressions are converted into follow-up tickets with explicit blocker IDs and cleanup owner.
- No new suppressions are introduced and no valid existing suppression loses its inline reason.


### `www-0oi5` - beads project-management web UI (list/kanban/issue views, Vercel theme)
_P1 · feature_

Simple React web app to view beads issue state for the platform migration. Backend shells bd --json; background bd dolt pull keeps it synced from remote. Views: list, kanban (by status), individual issue. Vercel look: true black, no gradients, shadcn components. Verify with agent-browser.


### `www-26ld` - Beads dolt sync diverged: push/pull both fail, ticket data was lost
_P1 · bug_

2026-06-09/10: bd dolt push failed (Uploading... loop, exit 1); a later pull reset local state losing the day's tickets (recreated via --id). Then dolt pull errored 'cannot merge with uncommitted changes' (fixed by bd dolt commit) and push still fails - local/remote diverged. The piped lefthook pre-push made this BLOCK git pushes; shipped tonight via LEFTHOOK_EXCLUDE=beads-sync. See CC-sg4p for the sync design.

**Acceptance:**

- [ ] Root cause documented: how refs/dolt/data on origin and local diverged (failed 'bd dolt push' mid-upload, then a 'bd dolt pull' reset local, wiping same-day tickets CC-dhi9/CC-jmpp)
- [ ] Local and remote dolt reconciled (one wins explicitly; recreated tickets preserved)
- [ ] 'bd dolt push' and 'bd dolt pull' both exit 0 again
- [ ] beads-sync pre-push hook made actually non-blocking (a dolt failure must warn, not abort the git push) per its documented design
- [ ] Regression test: gates green, committed type(ops/CC-xxx), merged + pushed, bd closed


### `www-4d31e2ab` - Prod E2E verification: all products working end-to-end
_P1 · task_

Human-driven end-to-end verification that all products are working correctly in production after the platform migration. Requires Calum to manually test each product surface.

## What to verify

### Control Center
- [ ] Wall panel loads at app--cc.worldwidewebb.co on iPad (1366x1024, no login prompt)
- [ ] All tiles show live data (climate, weather, lights, party mode)
- [ ] Light controls work from dashboard
- [ ] Workers healthy: kubectl get pods -n control-center (no CrashLoopBackOff)

### Captive Portal (www-guest WiFi)
- [ ] Connect a device to www-guest network
- [ ] Captive portal redirect fires, landing at captive-portal.worldwidewebb.co (or app--cp once DNS flipped)
- [ ] Submit email, receive onboarding email
- [ ] After authorization, device gets internet access
- [ ] Guest row appears in portal_guest table

### Text Your Ex
- [ ] app--tye.worldwidewebb.co loads
- [ ] Core TYE flow works end-to-end

### AMP
- [ ] app--amp.worldwidewebb.co loads
- [ ] Basic functionality works

### Infra health
- [ ] kubectl get pods -n control-center: all Running/Completed, 0 CrashLoopBackOff
- [ ] pg-backup jobs completing for all 3 products (CC, TYE, captive-portal)
- [ ] cloudflared pods healthy (2/2)
- [ ] CI green on main branch

**Acceptance:**

- [ ] All 4 product surfaces load without errors
- [ ] Captive portal guest onboarding completes end-to-end on a real device
- [ ] kubectl get pods shows 0 CrashLoopBackOff
- [ ] All pg-backup jobs Complete (not stuck Running)
- [ ] CI shows green on main


### `www-q002` - Captive portal: guest WiFi email-verified onboarding at captive-portal.worldwidewebb.co
_P1 · epic_

Production UniFi external captive portal for the home network, shipped as its own app in control-center (apps/captive-portal) and deployed via bosun, LAN-only (split-horizon DNS, no tunnel route). Guests: Landing (name+email+terms) -> 6-digit emailed OTP -> WiFi password -> UniFi authorize-guest for 30 days -> redirect. Design source of truth: docs/captive-portal/design/ (1:1, LandingBare landing, shadcn pure-black theme). PRD: docs/captive-portal/PRD.md. Epic AC = all children closed or deferred.


### `www-ss8s` - Kiosk auto-refresh: reload dashboard when a new build is deployed
_P1 · feature_

The iPad wall panel (Capacitor WKWebView kiosk; idle timer disabled, never reloads) keeps serving whatever bundle it first loaded. No client-side mechanism picks up OTA web deploys, so a newly-deployed SHA never appears until manual reload. Add a build-stamped version check: at build, emit a fetchable version stamp carrying the deployed SHA (SAME source as BUILD_HASH, baked via vite define); the web app polls it cache-busted every 10s (VERSION_POLL_MS=10_000) and also on visibilitychange->visible and window 'online', compares to the running BUILD_HASH, and calls an injected reload (default location.reload()) once on mismatch. Web-app side only (OTA, no App Store rebuild) per the documented OTA model - NOT a Swift reload timer.

**Acceptance:**

- Build emits a fetchable version stamp (e.g. dist/version.json) containing the build SHA, matching the BUILD_HASH baked into the running bundle (single source).
- Web app polls it on an interval governed by a single named constant (e.g. VERSION_POLL_MS), cache-busted (cache: no-store), and ALSO re-checks on visibilitychange->visible and window 'online'.
- On fetched-SHA != running BUILD_HASH, app calls location.reload() exactly once; guarded against reload loops.
- SHA match => no reload. Fetch/network errors are swallowed (kiosk keeps running, retries next tick).
- Unit test (fake timers + mocked fetch): reload fires on mismatch, not on match, guarded against loops.
- Verified in a real headless browser (agent-browser): serving version.json then changing its SHA triggers exactly one reload to the new build.


### `www-t2gw` - Board pan: native scroll-snap modes, trackpad jitter fix, A/C slider no longer pans board
_P1 · task_

Mac trackpad panning was jittery: the hand-rolled JS SmoothDamp spring re-centered on every scrollend, but trackpad scroll fires no pointer events so the code couldn't tell the user was still scrolling and the spring fought live input. Also the A/C setpoint slider dragged the whole board (onPointerDown started a board pan on any mouse press incl. on inner controls; sliders had no touch-action). And the 'fly to center' feel + viewport-crop comments were stale/misleading.

Fix: replace the JS spring with native CSS scroll-snap (compositor-thread, identical across trackpad/touch/mouse, nothing to fight). Add a live on-device switcher (proximity/mandatory/none + legacy spring) persisted to localStorage so Calum can A/B the feel on Mac + iPad, winner to be locked in later. Suspend scroll-snap during mouse-drag so the drag doesn't fight per-frame re-snap. Guard onPointerDown against interactive targets + touch-action:none on .range/.range-thumb so slider drags adjust the slider, not the board. Correct the stale 'iPad crop' comments (the stage is full-window, not cropped).

**Acceptance:**

- Trackpad pan is smooth on Mac (no spring fighting live scroll)
- Native scroll-snap modes selectable via on-device switcher, persisted to localStorage
- Mouse click-drag pan is smooth (snap suspended mid-drag, re-snaps on release)
- Dragging the A/C setpoint slider adjusts the slider and does NOT pan the board
- bun run typecheck clean; bunx biome check clean
- All apps/web tests pass (bun run test)
- Comments no longer claim a viewport crop that does not exist
- NOTE: switcher + 4 modes are intentionally retained until Calum picks the winning feel on iPad; follow-up ticket to strip the losers


### `www-tlop` - Beads dolt data dir wiped + re-inited at 16:43 2026-06-09 - find root cause
_P1 · bug_

**Acceptance:**

- [ ] Root cause identified for the 16:43:45 backup + empty re-init of .beads/dolt (server restart 16:43:47, database CC gone; suspects: bd hook migration, lefthook install during bun install in a fresh worktree, worktree bd discovery)
- [ ] Guard added so a worktree bd invocation can never re-init the shared data dir
- [ ] Decide whether to restore freshest state from .beads/backup (66MB darc, last_dolt_commit 9s9b0o69, backed up 16:43:45) or accept origin bootstrap


### `www-0jcb` - Add AMP management plane placeholder
_P2 · feature_

Create a minimal AMP (agent/administration management plane) web app placeholder so control-center has a dedicated internal platform surface for future project dashboards, pipelines, database/project management, and other cross-project operations. For now this should prove a separate app can be built and deployed without defining the final product shape.

**Acceptance:**

- [ ] A separate AMP app exists in the monorepo and builds independently.
- [ ] The AMP app renders a real placeholder page that clearly states it is the internal management plane and lists future platform surfaces without fake live data.
- [ ] Production deploy wiring can stand up the AMP app as its own workload/route without coupling it to the wall panel app.
- [ ] CI/build plumbing includes the AMP app where needed.
- [ ] Relevant docs mention AMP as the placeholder management plane.


### `www-1ck3` - [epic] M10: Ship Project-Management app to prod
_P2 · epic_

New product (products/project-management, the live beads board/epics/issues UI built in www-0oi5) needs to go to prod the same way the other products did. This is M10 of the world-wide-webb platform migration (www-jtp0) and is done LAST - AFTER M3-M9 are fully finished and verified. It is deliberately sequenced after everything else: it's a brand-new product stood up during the migration, not part of the original M0-M9 plan, so it must not compete for cutover focus or risk the core products' go-live.

Follows the established product-launch pattern (mirror M6 Text Your Ex / M8 AMP): declare product infra as a typed component in infra/, give it a flattened host route, build its image in CI with a path filter, deploy via Pulumi digest-pin, verify live in a browser.

Product-specific wrinkles to handle in the children:
- AUTH: it exposes the full beads issue DB (internal project state) -> must be PRIVATE, Cloudflare Access-gated like app--cc (email-OTP for Calum), NOT public. Route: app--pm.worldwidewebb.co (single-label, free Universal SSL).
- DATA ACCESS: the app shells 'bd --json' and runs a background 'bd dolt pull' to stay synced. Prod deploy must give the container access to the beads Dolt data (the dolt server / refs/dolt/data on origin) + the bd binary. This is the non-trivial bit - unlike the other products it has no Postgres of its own, its datastore IS beads/Dolt. Decide: bundle bd + dolt in the image and pull from origin on an interval, or point at an in-cluster dolt server.
- NAMESPACE: lands per whatever www-r3it decides for product namespacing.

Blocked by M9 (www-jtp0.9) - do not start until the core migration is closed.

**Acceptance:**

- [ ] M3-M9 of www-jtp0 are all closed before this epic starts (sequencing gate)
- [ ] All child issues under this epic are closed
- [ ] app--pm.worldwidewebb.co serves the PM app, TLS ssl_verify=0, behind CF Access (302/deny unauth, loads authed)
- [ ] Browser-verified live in prod at the real URL: list, kanban, and issue views render real beads data (screenshot each, describe in transcript)
- [ ] CI builds + deploys the image on path-filter; deploy digest-pin rolls it independently
- [ ] No regression to the other products' routes


### `www-1ck3.1` - Solve beads/Dolt data access for PM prod container
_P2 · task_

The PM app shells 'bd --json' + background 'bd dolt pull'. Prod container needs the bd binary + access to the beads Dolt data. Decide+implement: bundle bd+dolt in image and pull refs/dolt/data from origin on interval, OR point at an in-cluster dolt server. Datastore IS beads/Dolt (no Postgres).

**Acceptance:**

- [ ] Approach chosen + documented
- [ ] Container can run bd --json against synced data in prod
- [ ] dolt pull sync runs on interval without contending the parent repo git (see www-sg4p sync rules)


### `www-1ck3.2` - Declare PM product infra + private app--pm route
_P2 · feature_

Typed product component in infra/ (mirror TYE/AMP). Flattened host app--pm.worldwidewebb.co, CF Access-gated (email-OTP), tunnel route + proxied CNAME in infra/cloudflare. Namespace per www-r3it.

**Acceptance:**

- [ ] infra/ declares the PM workload + service
- [ ] infra/cloudflare declares app--pm route + CNAME + Access app (email-OTP)
- [ ] pulumi preview clean


### `www-1ck3.3` - CI build job + path filter for project-management image
_P2 · task_

Add build-project-management job + path filter (products/project-management/**) to ci.yml; deploy digest-pin rolls it independently (ccinfra:imageDigests.<svc>).

**Acceptance:**

- [ ] CI builds the image on path change
- [ ] deploy job sets the per-image digest + rolls only this workload


### `www-1ck3.4` - Deploy + browser-verify PM app live in prod (Access-gated)
_P2 · task_

Deploy to prod, verify app--pm serves the app behind CF Access: ssl_verify=0, 302 unauth, loads authed. Browser-verify list/kanban/issue views render real beads data, screenshot each.

**Acceptance:**

- [ ] curl app--pm: ssl_verify=0, 302 unauth
- [ ] authed: list/kanban/issue views render real data (screenshot each, described)
- [ ] no regression to other product routes


### `www-1kmz` - Bento placeholder regeneration algorithm - interactive test bed
_P2 · task_

Standalone HTML test bed (experiments/grid-test-bed.html) for designing the algorithm that regenerates the decorative placeholder/bento fill around the real tile cluster. Explores guillotine subdivision vs anchored backtracking packing, best-of-N quality search with a tunable weighted score (same-size adjacency, fault-line length, area uniformity, slivers), A/B weight calibration, and presets/board-size controls. Goal: replace the hardcoded INNER_FILL_LOCAL blob in apps/web/src/lib/placeholder-tiles.ts with a generator producing organic, varied, no-long-straight-line layouts. Open: long straight 'fault lines' are intrinsic to guillotine; next step is a structural line-breaking generator (generic rectangulation / relaxation). Determinism vs infinite-board tradeoff explored.

**Acceptance:**

experiments/grid-test-bed.html committed and opens in a browser; lets you pick algorithm, board size, block-size bounds, reserved-shape presets, run best-of-N quality search, and A/B calibrate score weights


### `www-2elp` - Guard against eager getLogger() at module-eval crash-looping a service
_P2 · task_

Three separate portal singletons (createResendEmailSender, createMockEmailSender, createPortalService) called getLogger() at CONSTRUCTION, and portal.ts builds them as module-level singletons evaluated during import - before server.ts calls createLogger(). Each threw '@repo/logger: getLogger() called before createLogger()' at module load and crash-looped the api, taking down the dashboard (CC-b87u prod outage). Unit tests didn't catch it (the test setup seeds createLogger first). Add a backstop so this class can't recur: (a) a CI/lint rule or simple AST/grep check flagging getLogger() called at module top-level or at the top of a factory that's invoked at module scope; AND/OR (b) a fast startup smoke test in CI that actually boots the api bundle (server.js) with minimal env and asserts it gets past module-eval without throwing (would have caught all three). Prefer (b) - it catches the real failure mode regardless of pattern. Consider also making @repo/logger's getLogger() lazily fall back to a default root instead of throwing, but that weakens the contract, so a smoke test is safer.

**Acceptance:**

- [ ] a CI check boots the api server bundle with minimal env and fails if module-eval throws (would catch eager getLogger)
- [ ] verified it fails on a planted eager getLogger() and passes on the fixed code
- [ ] documented in docs/logging.md


### `www-3892` - Sign in with Apple error 1001 - SIWA capability not enabled in portal
_P2 · bug_


### `www-3vv7` - block git push from main before beads sync
_P2 · task_

Add a pre-push guard that aborts fast on main, before the slow beads sync runs, and tells the user to move into a ticket-led worktree first.

**Acceptance:**

- pre-push exits non-zero when the current branch is main before bd dolt push runs
- the failure message tells the user to work from a ticket-led worktree and includes the worktree bootstrap command
- non-main pushes continue to the existing lint/knip/beads sync chain
- the change is documented if the hook behavior is load-bearing


### `www-4d4c4e5b` - Homelab resource audit: CPU/RAM/disk usage check
_P2 · task_

Check homelab Mac Mini resource usage to ensure k3s cluster isn't hitting limits. OrbStack VM is capped at 6144 MiB. Check: CPU per pod, RAM per namespace, disk usage on local-path PVCs, OrbStack VM headroom.

kubectl top nodes
kubectl top pods -n control-center --sort-by=memory
cmux top --sort mem (on homelab)
df -h (check SSD usage)

Flag anything approaching limits.

**Acceptance:**

- [ ] kubectl top nodes output shown (no node pressure conditions)
- [ ] kubectl top pods -n control-center shown, no pod near memory limit
- [ ] OrbStack VM RAM headroom > 1GB free
- [ ] SSD disk usage < 80%
- [ ] Any issues filed as follow-up tickets


### `www-4pce` - Upgrade homelab: larger Mac Mini or cloud infra to unblock memory-constrained workloads (Drizzle, Storybook in cluster)
_P2 · task_

**Acceptance:**

- [ ] Decision made: Mac Mini upgrade OR cloud/VPS provider chosen
- [ ] Cost estimate documented
- [ ] Plan for migration (if cloud) or purchase (if Mac Mini) filed


### `www-4pr7` - Remove ocx and kdco references
_P2 · task_


### `www-7ycd` - Set up Obsidian vault documenting the entire home/homelab setup
_P2 · feature_

Calum wants one browsable place documenting the whole home setup (network, NAS, homelab, Tailscale), stored somewhere agents can also read so Claude can reason about his home infrastructure. Obsidian as the front-end; storage location TBD at start of work.

**Acceptance:**

- [ ] Decide vault location + sync strategy (NAS share vs git repo vs Obsidian Sync) - agent-readable is a hard requirement
- [ ] Vault scaffolded with sections: network (UniFi gateway/APs/SSIDs), NAS (HomeTB shares/containers/crons), homelab Mac Mini (Swarm/bosun services), Tailscale devices, credentials index (1P item names only, never values), physical devices
- [ ] Seed pages written for the UniFi->NAS logging pipeline (from docs/unifi-logging.md) and the Tailscale device list
- [ ] Claude can read the vault (path documented in global CLAUDE.md) and use it to answer home-setup questions
- [ ] Gates green (test+typecheck+biome), no fake data, committed type(docs/CC-xxx), worktree->main merged + pushed, bd closed


### `www-8fzb` - docs: update CLAUDE.md tooling + TYE fastlane lane docs
_P2 · chore_


### `www-8oyc` - cleaning up codebase
_P2 · task_


### `www-9567ea8e` - Add api--tye to cloudflared tunnel ingress
_P2 · task_


### `www-96i` - Health/fitness section: weight + steps tiles (+ possible multi-page nav)
_P2 · feature_

Add a body-weight tracking feature to the wall-panel dashboard. Brainstorm pending - not yet scoped.

Context / seed data:
- Calum manually weighed in at 153.8 lbs on 2026-06-03 (first data point).
- Data source options to explore: (1) manual entry, (2) smart-scale auto-sync (Calum owns a smart scale), (3) iPhone step/activity tracking via Apple Health.

Design tension to resolve:
- The board is a FULL 12x6 single-page grid (no empty cells). A weight tile means either reorganizing the grid OR introducing multi-page navigation. Note existing ticket CC-awm (top bar with 'Home' label + notification center) which may be the natural home for page navigation.
- Decide: weight as a single tile vs a new 'health/fitness' page with weight + steps + trend chart.

Next step: run superpowers:brainstorming to scope data source, layout/navigation approach, and chart/trend treatment before writing a spec.

**Acceptance:**

- [ ] Design source decided (manual / smart-scale / Apple Health) and documented in spec
- [ ] Layout approach decided: single tile vs new page + nav primitive
- [ ] Weight tile renders on board at 1366x1024, verified via agent-browser screenshot
- [ ] Seed data point (153.8 lbs, 2026-06-03) visible in the tile
- [ ] No fake/placeholder data: unavailable weight shows Skeleton + retries (check-fake-data guard stays green)
- [ ] bun run test + typecheck + biome check green


### `www-9k6` - Re-explore actual iPad wall-panel screen size (reports 1366×1000 in fullscreen)
_P2 · task_

The iPad reports inner 1366×1000 as a FULLSCREEN web app (surprising - standalone/PWA should give the nominal 1366×1024; ~24px height is unaccounted for). For now BOARD set to 1366×1000 (what the device reports) as a best-fit placeholder so the panel renders 1:1 without letterbox scaling. Revisit: confirm the real usable area on-device, find where the 24px goes (safe-area-inset? status bar? home indicator?), and set the canonical resolution. Context: bezel is a desktop-only preview frame; on-device it's correctly OFF.

**Acceptance:**

iPad's true usable viewport confirmed via on-device ViewportDebug or equivalent; documented why a fullscreen/standalone web app reports innerHeight 1000 not 1024 (24px unaccounted); BOARD_W/BOARD_H in apps/web/src/lib/grid-constants.ts set to the verified device size; board renders true 1:1 (scale=1) on the device with no letterbox; white bezel confirmed desktop-preview-only.


### `www-b2fb9ef1` - Fix unrouted *.worldwidewebb.co subdomains returning CF 521 Web Server Down
_P2 · bug_

**Acceptance:**

- [ ] curl https://t.worldwidewebb.co (or any non-routed subdomain) returns a controlled response (403 Access block or 404), NOT a CF 521/522/523 error
- [ ] No Cloudflare 'Web Server is Down' page exposed for any unregistered subdomain
- [ ] Root cause: cloudflared tunnel missing a catch-all ingress rule OR CF Access wildcard deny not yet applied (CC-cuuw); fix whichever layer is faster - catch-all ingress rule in tunnel config returning 404 is the minimum; full Access wildcard (CC-cuuw) is the proper fix
- [ ] Regression test: curl exit-code / HTTP status check is red before fix, green after
- [ ] Gates: bun run test + typecheck + bunx biome check green
- [ ] No fake data (check-fake-data guard green)
- [ ] Committed fix(infra/www-xxx); worktree branch merged to main + pushed; bd closed


### `www-c49273f0` - Beads UI: remove sync indicator tick, reduce sync interval to 10s
_P2 · task_


### `www-c9d` - ControlsTile findFanClimate uses unsorted .find() - same fragility class as old alphabetical climate-entity bug
_P2 · bug_

Noted while fixing CC-59u. findFanClimate selects the fan-capable climate entity via an unsorted Array.find(), so which entity wins depends on HA's return order - the same fragility that caused the old alphabetical climate-entity bug (fixed by CLIMATE_ENTITY_ID targeting climate.home). Currently masked only because the Tesla entity (climate.evee_climate) has fan_modes:null so it's skipped. If a second fan-capable climate appears, selection becomes order-dependent. Fix: target the configured house thermostat (CLIMATE_ENTITY_ID) explicitly, or sort deterministically.

**Acceptance:**

findFanClimate selects the fan entity deterministically (explicit CLIMATE_ENTITY_ID or sorted), not via unsorted .find(); a test asserts selection is stable when HA returns multiple fan-capable climates in arbitrary order


### `www-dihf` - Restore Drizzle Studio to cluster (currently scaled to 0 / dormant due to Mac Mini RAM)
_P2 · task_

**Acceptance:**

- [ ] Drizzle deployment scaled back up and healthy
- [ ] drizzle.worldwidewebb.co reachable and CF Access protected
- [ ] Deployment stays stable under normal cluster load


### `www-dk2b` - CF IaC: adopt-or-document zone settings, Access IdPs, and non-tunnel DNS records
_P2 · task_

**Acceptance:**

- [ ] Enumerate live CF zone settings, Access identity providers (incl. one-time-PIN), and all DNS records NOT pointing at the tunnel (apex/MX/TXT/SPF/verification), via the account-owned token
- [ ] For each: either declare as a protect:true Pulumi resource in infra/cloudflare/src/ OR document an explicit 'not managed, reason' note in the program header
- [ ] pulumi preview shows zero destructive churn after adoption
- [ ] One-time-PIN IdP decision recorded (manual vs IaC)


### `www-ec0n` - Party mode: setting speed when lamps off should turn lamps on
_P2 · bug_

**Acceptance:**

- [ ] Clicking slow/medium/fast party mode when all lamps are off turns lamps on and starts animation
- [ ] Party mode persists correctly after lamps turn on
- [ ] No regression: party mode stop still works


### `www-n61g` - ocx setup
_P2 · task_


### `www-nj0w` - Strip losing board snap modes + on-device switcher once feel is chosen
_P2 · task_

CC-t2gw shipped 4 selectable snap modes (proximity/mandatory/none + legacy spring) plus a bottom-right switcher and localStorage persistence, so Calum can A/B the pan feel on Mac + iPad. Once he picks the winner, delete the other modes, the SnapModeSwitcher component, the SNAP_MODES/SNAP_CSS/SNAP_MODE_* scaffolding, the snapMode state/ref/persistence, and (if spring loses) the smoothDamp/springTo/onSettle JS spring machinery. Hardcode the winning scroll-snap-type.

**Acceptance:**

- Winning snap mode hardcoded on the stage; no runtime switcher in the DOM
- SnapModeSwitcher + SNAP_MODES/SNAP_CSS/SNAP_MODE_LABEL/loadSnapMode + snapMode state/ref removed
- If spring not chosen: smoothDamp/springTo/onSettle spring removed too
- typecheck + biome + tests green; screenshot @1366x1024 unchanged


### `www-nvz7` - Restore Storybook to cluster (currently scaled to 0 / dormant due to Mac Mini RAM)
_P2 · task_

**Acceptance:**

- [ ] Storybook deployment scaled back up and healthy
- [ ] storybook.worldwidewebb.co reachable and CF Access protected
- [ ] Deployment stays stable under normal cluster load


### `www-o0m8` - Replace op inject with op read in Tiltfile to use shim cache
_P2 · chore_

**Acceptance:**

- [ ] tilt/load-secrets.sh reads each secret via op read
- [ ] Tiltfile calls load-secrets.sh instead of op inject
- [ ] Dev stack starts successfully without 1P rate limit errors


### `www-o4z8` - perf probe (delete me)
_P2 · task_


### `www-o72i` - Build a design system in claude.ai/design for the dashboard tiles
_P2 · task_

Manual task for Calum. Use claude.ai/design to create a design system for control-center: drag in / recreate the tiles we already have, then keep iterating on the new tiles there. Goal is a shared visual source of truth for the wall-panel dashboard before building more tiles in code.

**Acceptance:**

- A claude.ai/design project exists for control-center
- Existing tiles are represented in it
- New/in-progress tiles continue to be designed there


### `www-rfe7` - Codebase cleanup: error handling, type safety, testing gaps, CI efficiency
_P2 · epic_

**Acceptance:**

All children closed or deferred


### `www-rfe7.2` - Fix process.exit(0) racing in-flight worker cycles
_P2 · bug_

**Acceptance:**

- [ ] runtime.drain() method exists and resolves only after in-flight cycle completes
- [ ] Signal handler awaits drain() before process.exit(0)
- [ ] uncaughtException/unhandledRejection handlers flush final stats
- [ ] bun run test green
- [ ] bun run typecheck green
- [ ] bunx biome check . clean
- [ ] No fake/placeholder data, check-fake-data guard green
- [ ] Committed fix(worker/CC-xxx); worktree→main merged + pushed; bd closed


### `www-rfe7.4` - Add missing app dirs to vitest coverage include
_P2 · chore_

**Acceptance:**

- [ ] Coverage include glob in vitest.config.ts covers worker, media-worker, captive-portal, logger, infra
- [ ] bun run test:coverage runs without error
- [ ] bun run typecheck green
- [ ] bunx biome check . clean
- [ ] Committed chore(ci/CC-xxx); worktree→main merged + pushed; bd closed


### `www-rfe7.5` - Add unit tests for worker runtime
_P2 · task_

**Acceptance:**

- [ ] apps/worker/src/__tests__/ exists with runtime.test.ts
- [ ] Tests: throwing run() fires error handler, consecutive failures tracked, recovery transitions logged, drain() works
- [ ] bun run test green
- [ ] bun run typecheck green
- [ ] bunx biome check . clean
- [ ] Committed test(worker/CC-xxx); worktree→main merged + pushed; bd closed


### `www-rllu` - HA apple_tv integration exposes no entity_picture - artwork pipeline gets nothing to show
_P2 · bug_

**Acceptance:**

- [ ] Root-cause why media_player.living_room_tv never has entity_picture (likely missing AirPlay pairing/credentials on the HA apple_tv integration - pyatv needs AirPlay for artwork)
- [ ] After the HA-side fix, /media/tv-artwork returns 200 with image bytes while YouTube is playing
- [ ] TV tile shows the real artwork on the board (screenshot @1366×1024)
- [ ] Gates green (test+typecheck+biome), no fake data, committed fix(ops/CC-xxx) if any repo change, bd closed


### `www-ukat` - CI: web prod silently drifts behind main (deploy cascade-skip + path-filter gap)
_P2 · bug_

Root-caused while fixing the bed2351 staleness (see CC-ss8s). Two compounding CI failure modes let web prod fall 16 commits behind main with no signal:
1) build-web + deploy both 'needs:[changes,test]'. A web-touching commit that FAILS the test job (e.g. CC-5zxz failed biome) cascades build-web+deploy to skipped - the broken commit doesn't deploy (correct) but nothing flags that prod is now stale.
2) When the fix lands in a LATER commit that doesn't touch apps/web/** (e.g. the biome fix f9809a3), dorny/paths-filter sets web=false, so web is never rebuilt/redeployed - the earlier web changes stay stranded. Prod drifts silently.
Right fix (discuss): detect prod-digest != main and force a redeploy, OR a scheduled redeploy/drift-check, OR don't path-filter-skip deploy when the running digest is behind. At minimum surface an alert when prod is N commits behind main.

**Acceptance:**

- A mechanism exists so web prod cannot silently sit behind main after a test-failure-then-non-web-fix sequence (drift detection, forced redeploy, or scheduled reconcile).
- Documented in packages/bosun/README.md or ci docs.
- Reproduces-and-resolves the exact CC-5zxz->f9809a3 scenario in a test or documented manual check.


### `www-024k` - Add repo CLI for running product dev stacks
_P3 · feature_

**Acceptance:**

- [ ] `cc up <product>` (e.g. `cc up text-your-ex`, `cc up control-center`) starts the product's full local dev stack via Tilt
- [ ] `cc list` shows all available products with their stack entry points
- [ ] `cc help` / bare `cc` shows usage
- [ ] Unknown product gives a clear error with list of valid names
- [ ] Gates: bun run test + typecheck + bunx biome check green
- [ ] No fake data (check-fake-data guard green)
- [ ] Committed feat(scripts/www-xxx); PR to `main` merged; bd closed


### `www-0wsk` - Investigate TYE architecture: does app--tye need a public API route?
_P3 · task_

The TYE API is declared as internalService (cluster-only, no public tunnel route). The frontend (app--tye.worldwidewebb.co) is public. Question: how does the frontend call the API in prod? Options: (a) frontend + API are co-located/SSR so no cross-origin call needed, (b) frontend calls API via an internal nginx proxy (same-origin trick), (c) API needs a public api--tye route (not currently planned). Calum noted the internal-only setup was intentional - verify it works end-to-end before considering any change. Do NOT add a public API route without Calum's explicit decision.

**Acceptance:**

- [ ] Understand how app--tye frontend calls the API in prod (code review + live test)
- [ ] If it works as-is, close with 'internal routing confirmed, no public route needed'
- [ ] If it needs a public route, create a separate ticket with Calum's explicit go-ahead


### `www-2x4` - DogCamTile: live camera stream on tap
_P3 · task_

DEFERRED (Calum: tricky, skip for now - generic ticket only). DogCamTile.tsx:80-185 shows a snapshot but tapping 'Live' doesn't connect a real stream. Goal: live MJPEG or WebRTC feed from the living-room HA camera on tap, with auto-reconnect. Design ref evee-tiles.jsx:248-273 (EDogCam live state). Requires stream URL wiring from HA + MJPEG/WebRTC choice; scope independently.

## Acceptance Criteria

Tapping live connects to the real HA camera stream (MJPEG/WebRTC), shows live video (not a snapshot), reconnects on drop; no hardcoded stream URLs.

## Acceptance Criteria

Tapping live connects to the real HA camera stream (MJPEG/WebRTC), shows live video (not a snapshot), reconnects on drop; no hardcoded stream URLs.

**Acceptance:**

Tapping live connects to the real HA camera stream (MJPEG/WebRTC), shows live video (not a snapshot), reconnects on drop; no hardcoded stream URLs.


### `www-5s16` - Investigate 1Password Connect (self-hosted) to kill op rate-limiting
_P3 · task_

The 1Password service-account token rate-limits HARD on uncached reads - repeated op reads (CLI, agents, deploys) hit the cloud API quota and lock out, sometimes for a while. Investigate running 1Password Connect, a self-hosted sync server (deployable in our OrbStack k8s cluster), which syncs the vault locally and serves secrets with no per-read cloud rate limit.

Two consumers to evaluate:
1. In-cluster: External Secrets Operator already runs (1Password SDK provider). ESO supports a 'onepasswordConnect' provider - point it at an in-cluster Connect server instead of the cloud SDK to remove the per-deploy op churn (see memory bosun-agent-op-rate-limit / the old rate-limit saga).
2. Local dev + agents: 'op connect' / OP_CONNECT_HOST + OP_CONNECT_TOKEN lets the CLI read from the local Connect server, no cloud round-trip. This is what hit us today during CF Access debugging.

Compare vs alternatives Calum floated: a different secrets manager entirely. Weigh: Connect keeps 1P as source of truth + removes rate limits, but adds a stateful in-cluster service + a Connect credentials file/token to bootstrap (chicken-and-egg secret). Also note RAM budget - homelab/cluster is RAM-constrained.

NOT part of www-jtp0 migration. Standalone infra/ops investigation, do later.

**Acceptance:**

- [ ] Document how 1P Connect works + what it costs (RAM, the bootstrap credentials-file/token, sync model)
- [ ] Decide: ESO via Connect vs current SDK provider - does it remove the per-deploy rate-limit churn?
- [ ] Decide: local CLI/agent reads via op connect - does it remove the interactive rate-limit we hit today?
- [ ] Compare against switching secrets managers entirely (effort vs benefit), recommend one path
- [ ] If Connect chosen: file follow-up impl tickets (deploy Connect in infra/, wire ESO + local op, bootstrap token in 1P)


### `www-6goo` - Normalize workspace package name prefixes (@cc/* vs @repo/*)
_P3 · task_

Area: repo. Found during CC-q002 validation: workspaces are inconsistently named (@repo/web, @repo/worker, @repo/logger vs @cc/api, @cc/captive-portal). Pick one prefix and rename all, updating imports + knip + tsconfig paths. Pure churn, do in a quiet moment.

**Acceptance:**

- [ ] One prefix across all workspace package.json names; all imports updated
- [ ] Gates: bun run test + typecheck + bunx biome check + bunx knip green
- [ ] Committed refactor(repo/CC-xxx); merged + pushed; bd closed


### `www-6n0l` - Lint: flag var(--token) references to CSS custom properties not defined in tokens.css
_P3 · chore_

**Acceptance:**

- [ ] A script greps apps/web/src for var(--x) references and fails on tokens with no definition in styles/tokens.css (the --ink-1 class of bug: silently-invisible UI)
- [ ] Wired into lefthook pre-commit or CI test job
- [ ] Gates green, committed chore(web/CC-xxx), bd closed


### `www-7pwt` - Blackout theme for opencode
_P3 · task_

Port the Blackout VS Code theme to opencode as a custom theme. True-black background, Vercel blue accent, green strings, purple keywords. Default theme for the repo.


### `www-8o6q` - Lights tile tap: cycle through all-on / kitchen-on / under-cabinet-on / all-off
_P3 · feature_

**Acceptance:**

- [ ] Tapping lights tile cycles: all on → kitchen on (under-cabinet only) → overhead on → all off → all on
- [ ] Each state correctly sets desired state for the relevant devices
- [ ] Visual state on tile reflects the current step


### `www-ahuw` - Recolor lines badge to purple (blueviolet)
_P3 · task_

Calum requested the README 'lines' badge be purple. Change loc.json color to blueviolet in gen-badges.ts.

**Acceptance:**

loc.json color is 'blueviolet'; files/commit stay blue; shields renders


### `www-bmw` - CI: add GitHub Actions workflow to run gates (typecheck, biome, vitest) on push/PR
_P3 · task · deferred_


### `www-czf4` - Update OpenCode default models
_P3 · task_

Change the OpenCode config defaults to use gpt-5.3-codex as the main model and deepseek-v4-flash-free as the small model.


### `www-d3t` - TeslaTile: replace static SVG map with live GPS map
_P3 · task_

DEFERRED (Calum: tricky, skip for now - generic ticket only). TeslaTile.tsx:96-182 renders a hardcoded SVG street grid (TeslaMap). HA device_tracker already returns lat/lon (tesla-service.ts:107-111) but the frontend discards them. Goal: a live map (MapLibre/Mapbox/tile-based) centered on the car's real GPS, pin moving with the car. Design ref evee-tiles.jsx:188-214 (EMap). Requires map library + key management; scope independently.

## Acceptance Criteria

Map centered on real HA GPS coords; pin updates as the car moves; no static SVG grid; no hardcoded coordinates.

## Acceptance Criteria

Map centered on real HA GPS coords; pin updates as the car moves; no static SVG grid; no hardcoded coordinates.

## Acceptance Criteria

Map centered on real HA GPS coords; pin updates as the car moves; no static SVG grid; no hardcoded coordinates.

**Acceptance:**

Map renders real basemap (not the static SVG grid) centered on HA GPS coords; viewport recenters as the car moves; pin sits on real GPS; fixed street-level zoom looks right at 1366x1024; theme matches the dark/green tile aesthetic; no API key; no hardcoded coordinates beyond the home default-center; pmtiles file gitignored (not committed); verified live in-browser with a screenshot in docs/screenshots/.


### `www-hra0` - Harden captive-portal LAN edge on homelab: no repo checkout, launchd autostart path mismatch, orphan portal-certs volume
_P3 · chore_

Surfaced finishing CC-q002.22. The portal-lan container was deployed by hand-running scripts/portal-lan.sh over ssh (no repo on homelab); the launchd plist isn't installed there and references a path that doesn't exist. Container is --restart=always so it survives docker/reboot via OrbStack-at-login, but the autostart belt-and-suspenders is absent. Also an orphan 'portal-certs' volume holds a stale cert (CC-mz05 fix moved issuance to control-center_portal-certs); harmless but should be pruned. Agent could not prune it (prod-write guard).

**Acceptance:**

- [ ] homelab has a tracked control-center checkout (or portal-lan.sh + plist installed from one) so scripts/portal-lan.sh + com.calum.portal-lan.plist are not hand-scp'd one-offs
- [ ] com.calum.portal-lan.plist is installed in ~/Library/LaunchAgents on homelab and points at a real path (currently references a non-existent /Users/calum/code/... path)
- [ ] orphan docker volume 'portal-certs' (un-namespaced, stale cert from before CC-mz05) removed on homelab; only control-center_portal-certs remains
- [ ] confirm portal-lan + portal survive an OrbStack restart


### `www-rfe7.10` - Add integration tests for database queries
_P3 · task_

**Acceptance:**

- [ ] Docker-based integration test setup exists (vitest postgres container)
- [ ] At least 3 critical-path DB queries tested (light desired-state write+read, climate state round-trip, party mode persistence)
- [ ] bun run test green
- [ ] bun run typecheck green
- [ ] bunx biome check . clean
- [ ] Committed test(api/CC-xxx); worktree→main merged + pushed; bd closed


### `www-rfe7.11` - Add bun install caching and parallelize CI gate steps
_P3 · chore_

**Acceptance:**

- [ ] oven-sh/setup-bun has cache: true
- [ ] Test job path-filtered (skips on docs-only pushes)
- [ ] Typecheck, lint, knip, hermetic scripts run in parallel job matrix
- [ ] New-image first-push handles missing tag gracefully
- [ ] Committed chore(ci/CC-xxx); worktree→main merged + pushed; bd closed


### `www-rfe7.13` - Fix storybook doc guard to check meta config, not whole-file grep
_P3 · chore_

**Acceptance:**

- [ ] check-storybook-docs.sh checks for actual tags: ['autodocs'] in meta config, not grep of whole file
- [ ] Existing passing stories still pass
- [ ] A story with autodocs in a comment but not in meta correctly fails
- [ ] Committed chore(scripts/CC-xxx); worktree→main merged + pushed; bd closed


### `www-rfe7.14` - Make NFS PV size configurable and fix unit parsing
_P3 · chore_

**Acceptance:**

- [ ] VolumeSpec has configurable size field (default 1Gi)
- [ ] sizeToMib() accepts lowercase unit suffixes (g, m, k)
- [ ] bun run typecheck green
- [ ] bunx biome check . clean
- [ ] Committed chore(infra/CC-xxx); worktree→main merged + pushed; bd closed


### `www-w26q` - Swap primary email to calum@worldwidewebb.co
_P3 · task_

Move Calum's primary login/identity email from [redacted-personal-email] to calum@worldwidewebb.co across services where it's used as the human identity. NOT part of the www-jtp0 migration epic - standalone, do later. Touch points to audit when starting: CF Access email-OTP allow policies (the 'allowedEmail' Pulumi secret config), 1Password identity, any service allow-lists. Commit identity stays the GitHub noreply address - this is about the human SSO/OTP email only.

**Acceptance:**

- [ ] Inventory every place [redacted-personal-email] is used as the *human identity* (CF Access allowedEmail, app allow-lists, 1P)
- [ ] calum@worldwidewebb.co mailbox/alias confirmed receiving
- [ ] CF Access email-OTP allow policy updated to new email (Pulumi 'allowedEmail' secret config rotated)
- [ ] Login to an OTP-gated host with new email succeeds, OTP received
- [ ] no-personal-email guard still passes (new email is not the blocked one; old one purged where applicable)


## audit (30)

### `www-355t` - Codebase audit improvements (Claude + Codex)
_P1 · epic_

Consolidated improvements from the 2026-06-05 dual audit (CLAUDE-FINDINGS.md static fan-out + CODEX-FINDINGS.md ran-the-toolchain). Children are tagged by priority (P0-P3) and category label: defect/refactor/config/library/structure. Full detail + source attribution in AUDIT-RECOMMENDATIONS.md.

Labels: `audit`


### `www-355t.18` - Collapse or rename packages/api (the @cc/api wrapper)
_P2 · task_

**Acceptance:**

Either packages/api is deleted and web imports @repo/api/trpc directly, OR it is renamed (e.g. @cc/contracts) with a README explaining its role; build+typecheck green.

Labels: `audit`, `structure`


### `www-355t.19` - Create packages/contracts for shared schemas/enums/ids (ControlKey, HvacMode, WEATHER_CODES, tile/modal ids)
_P2 · task_

**Acceptance:**

ControlKey, HvacMode, the WMO WEATHER_CODES table, and tile/modal ids are defined once in a shared package and imported by api+web; no duplicate copies remain.

Labels: `audit`, `structure`


### `www-355t.28` - Centralize API + frontend test helpers
_P2 · task_

**Acceptance:**

apps/api/src/test/ holds shared DB+HA mocks and chain/row builders; frontend has tile query-state builders; at least 3 existing suites use them with no behavior change.

Labels: `audit`, `refactor`


### `www-355t.34` - jest-dom via setupFiles instead of per-file import
_P2 · task_

**Acceptance:**

apps/web/vitest.config.ts sets setupFiles:['@testing-library/jest-dom/vitest']; per-file jest-dom imports are removed; tests green.

Labels: `audit`, `config`


### `www-355t.35` - Enable stricter TS flags (noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax, noImplicitReturns, noFallthroughCasesInSwitch)
_P2 · task_

**Acceptance:**

Root tsconfig enables the listed flags; the resulting type errors are fixed; 'bun run typecheck' is green across all workspaces.

Labels: `audit`, `config`


### `www-355t.36` - Tighten Biome (noImportCycles, a11y rules, bosun noProcessEnv glob, schema pin)
_P2 · task_

**Acceptance:**

biome.json enables suspicious/noImportCycles + explicit a11y rules, widens the bosun noProcessEnv override to providers/env.ts, pins the schema to the installed version; biome check passes.

Labels: `audit`, `config`


### `www-355t.37` - Pin Bun consistently + CI install cache
_P2 · task_

**Acceptance:**

package.json has packageManager bun@<ver>; CI setup-bun pins that version (not latest); Docker images aligned; CI caches ~/.bun/install/cache.

Labels: `audit`, `config`


### `www-355t.39` - Add Storybook browser-test lane to CI
_P2 · task_

**Acceptance:**

apps/web has test:storybook; a CI job (path-filtered on apps/web/src + .storybook) runs the Playwright Storybook project and gates on it.

Labels: `audit`, `config`


### `www-355t.40` - Fix React act(...) warnings in Controls tests
_P2 · task_

**Acceptance:**

bun run test produces no act(...) warnings; optionally the suite fails on unexpected console.error with an allowlist.

Labels: `audit`, `config`


### `www-355t.41` - Reduce CI Docker build-job duplication (matrix/reusable workflow)
_P2 · task_

**Acceptance:**

The four build jobs are expressed as a matrix or reusable workflow; behavior (path filters, digests) unchanged; CI green.

Labels: `audit`, `config`


### `www-355t.42` - Config hygiene: .editorconfig, bunfig.toml, dead api outDir, dev/prod Postgres alignment
_P2 · task_

**Acceptance:**

.editorconfig + bunfig.toml added; dead outDir/rootDir removed from apps/api/tsconfig; dev vs prod Postgres version+db-name aligned or documented.

Labels: `audit`, `config`


### `www-355t.43` - Adopt superjson as the tRPC transformer
_P2 · task_

**Acceptance:**

tRPC server+client use superjson; API returns Date objects (no *Iso string fields needed for that purpose); client receives Dates; tests green.

Labels: `audit`, `library`


### `www-355t.44` - Adopt pino for structured API logging
_P2 · task_

**Acceptance:**

server.ts uses pino (pino-pretty in dev); console.* logging in the API is replaced; logs are JSON in production.

Labels: `audit`, `library`


### `www-355t.45` - Use drizzle-orm/zod to generate router output schemas
_P2 · task_

**Acceptance:**

DB-backed router outputs (events, device-commands, sync-status, weather) use createSelectSchema-derived schemas; hand-written shadow .output() schemas for those are removed.

Labels: `audit`, `library`


### `www-355t.46` - Add Knip for unused files/exports/deps
_P2 · task_

**Acceptance:**

knip runs via a script and reports unused files/exports/deps; an initial baseline is committed or the flagged items triaged.

Labels: `audit`, `library`


### `www-355t.49` - Add react-scan (dev) + run vite-bundle-visualizer
_P2 · task_

**Acceptance:**

react-scan is wired in main.tsx behind import.meta.env.DEV (zero prod cost); a bundle treemap has been captured and any obvious lazy-load win is filed/applied.

Labels: `audit`, `library`


### `www-355t.50` - Add Renovate for grouped dependency updates
_P2 · task_

**Acceptance:**

renovate.json exists with grouped presets (Bun/Vite/React/Storybook, tRPC/TanStack, Drizzle/PG, Docker, Actions); first PRs open as expected.

Labels: `audit`, `library`


### `www-355t.51` - Adopt MSW for network-layer tests
_P2 · task_

**Acceptance:**

At least one component/integration suite exercises real query behavior via MSW fetch handlers instead of mocking trpc hooks directly.

Labels: `audit`, `library`


### `www-355t.52` - Enable Chromatic/Storybook visual regression
_P2 · task_

**Acceptance:**

Visual regression runs against the existing Storybook (chromatic-com/storybook already installed); a baseline is captured and a CI/advisory check is wired.

Labels: `audit`, `library`


### `www-355t.53` - tRPC SSE subscriptions: push HA state instead of polling
_P3 · feature_

**Acceptance:**

controls/climate use httpSubscriptionLink; a HA state change reflects in the UI in <2s without polling; polling fallback retained; verified in browser.

Labels: `audit`, `library`


### `www-355t.54` - Restructure into tile domain folders + API domains/integrations
_P3 · task_

**Acceptance:**

components/tiles is grouped by domain (weather/climate/controls/network with views/modals/stories/tests); apps/api/src is split into domains/ + integrations/; build+tests green.

Labels: `audit`, `structure`


### `www-355t.55` - Add jscpd 'duplicates' script (advisory, non-blocking)
_P3 · task_

**Acceptance:**

package.json has a duplicates script running jscpd with --exitCode 0; optionally an advisory CI job emits the report without failing.

Labels: `audit`, `config`


### `www-355t.56` - Evaluate React Aria Dialog/FocusScope for Modal focus management
_P3 · task_

**Acceptance:**

Modal traps focus and restores it on close (via React Aria or equivalent); keyboard nav verified; visual style unchanged.

Labels: `audit`, `library`


### `www-355t.57` - Evaluate @use-gesture/react for Board drag/pinch
_P3 · task_

**Acceptance:**

A spike documents whether use-gesture replaces the hand-rolled pointer logic while preserving native scroll; decision recorded (adopt/defer).

Labels: `audit`, `library`


### `www-355t.58` - Add docs/repo-map.md for agents
_P3 · task_

**Acceptance:**

docs/repo-map.md explains how to add a tile, modal variant, API service/router, bosun service/job, and which tests to run per path.

Labels: `audit`, `structure`


### `www-355t.59` - Decide on Turborepo (Claude: skip / Codex: adopt)
_P3 · decision_

**Acceptance:**

A decision is recorded based on measured CI/build duration: adopt Turborepo caching or defer with rationale.

Labels: `audit`, `config`


### `www-355t.60` - Evaluate ts-pattern for climate mode/action mapping
_P3 · task_

**Acceptance:**

A spike shows whether ts-pattern improves exhaustiveness of climate discriminated-union mapping; applied only where it clarifies.

Labels: `audit`, `refactor`


### `www-355t.61` - Evaluate Effect for the integration/poller layer
_P3 · decision_

**Acceptance:**

A decision/spike on one boundary (weather-ingest or device-sync) records whether Effect's typed errors/retries/schedules are worth a partial adoption; no blanket conversion.

Labels: `audit`, `structure`


### `www-355t.62` - PK migration serial->generatedAlwaysAsIdentity; @trpc/openapi when stable; @t3-oss/env-core if schema grows
_P3 · chore_

**Acceptance:**

Tracked follow-ups: a Drizzle migration moves PKs to generatedAlwaysAsIdentity; @trpc/openapi revisited once stable; env parser revisited only if the schema grows.

Labels: `audit`, `config`


## project-management (9)

### `www-3agy` - Build Temporal-backed ticket workflow in project-management
_P1 · epic · in_progress_

Milestone epic for the new Beads-backed tickets workflow. This moves ticket creation, execution, review, merge, observability, and controls into products/project-management with Temporal durable orchestration.

**Acceptance:**

- [ ] All child tickets are closed or explicitly deferred
- [ ] /ticket creates immediate Beads tickets using writing-tickets
- [ ] Project Management UI shows and controls ticket workflow queues
- [ ] Temporal worker runs builder, reviewer, and merge workflows locally
- [ ] One end-to-end proof ticket goes from ticket-ready to closed through Project Management UI
- [ ] TDD evidence exists for workflow state transitions, Beads queue behavior, deterministic activities, and UI controls
- [ ] Credit-safe proof uses only one real OpenCode builder/reviewer path; failure/retry paths are tested with fakes

Labels: `project-management`, `temporal`, `tickets-workflow`


### `www-3agy.16` - Prove one end-to-end tickets workflow
_P1 · task_

Run exactly one credit-safe real proof of the full workflow. Use a tiny proof ticket and bounded proof-mode models/steps. Failure/retry/human paths must be tested with fake Activities instead of real OpenCode calls.

**Acceptance:**

- [ ] One tiny proof ticket is created with /ticket
- [ ] Project Management UI is used to observe/control the flow
- [ ] Temporal workflow claims the ticket
- [ ] Builder runs in tmux/OpenCode and produces a pushed branch
- [ ] Reviewer verifies and moves to ticket-verified
- [ ] Merge workflow merges/pushes to main
- [ ] Ticket closes only after main push succeeds
- [ ] Evidence records ticket id, branch, commit, Temporal workflow id/run id, tmux sessions, OpenCode session ids, logs, and metrics
- [ ] Only one real OpenCode builder/reviewer proof is run; retry/failure/human paths use fakes

Labels: `project-management`, `temporal`, `tickets-workflow`


### `www-68rn` - Handle origin/main advancement in merge queue
_P1 · task · in_progress_

Merge queue push can race with CI badge commits or other writers advancing origin/main after the initial pull. Add bounded sync/replay/re-gate/retry behavior so safe remote advancement is handled without force-push.

Labels: `project-management`, `ticket-workflow`


### `www-41hj` - Remove close command preview from ticket detail
_P2 · task · in_progress_

The detailed ticket view currently includes a "Close Command Preview" panel with a reason textarea, generated bd close command, Preview action, and Copy action. Remove this panel from the ticket detail UI so the detail view focuses on ticket status, workflow, metadata, and content without exposing the manual close command helper.

**Acceptance:**

- [ ] Detailed ticket view no longer renders the "Close Command Preview" panel.
- [ ] The reason textarea for the close command preview is removed from the detailed view.
- [ ] The generated bd close command row, Preview action, and Copy action for this panel are removed from the detailed view.
- [ ] Removing the panel does not break other ticket detail actions or workflow/log sections.
- [ ] Run the relevant Project Management UI lint/typecheck/test command for the touched files and record the result in the ticket or closing reason.

Labels: `project-management`, `ticket-human`, `ui`


### `www-ff3b` - Fix Project Management detail deps missing for blocked workflow tickets
_P2 · bug · in_progress_

The Project Management UI detail drawer can show 'Deps: none' for workflow tickets that are actually blocked by Beads dependencies. Example: www-qw54.3 depends on www-qw54.2 and www-qw54.5 depends on www-qw54.4, but live /api/board-data returned blockedBy: [] / blocks: [], so the detail drawer hid the blockers and the queued lane looked runnable when the Temporal queue correctly skipped them.

**Acceptance:**

- [ ] /api/board-data includes blockedBy and blocks for tickets with Beads dependency edges, including ticket-ready workflow tickets blocked by open dependencies.
- [ ] The detail drawer shows the blocking ticket ids/titles instead of 'No dependencies' for dependency-blocked tickets.
- [ ] The workflow queued lane visually distinguishes ticket-ready-but-blocked tickets from runnable ticket-ready tickets.
- [ ] Server tests cover dependency mapping for www-qw54.3 -> www-qw54.2 style blocked workflow tickets.
- [ ] UI/model tests cover the detail drawer dependency rows for blocked workflow tickets.
- [ ] From products/project-management, bun run test exits 0.
- [ ] From products/project-management, bun run typecheck exits 0.

Labels: `project-management`, `ticket-human`


### `www-qw54` - Add Project Management workflow observability
_P2 · epic_

Add durable local observability for Project Management ticket workflows: live logs, archived stdout/stderr, and OpenCode token usage totals.

Temporary storage decision: Project Management intentionally shares the existing local Temporal Postgres container for now, but uses a separate project_management database/schema. Temporal stays on its own temporal database/tables. This is Tilt/local-only until Project Management is productized.

**Acceptance:**

- [ ] All child tickets are closed or deferred.
- [ ] The Project Management UI can show workflow logs and token totals from local Postgres.
- [ ] The design note explicitly records that Temporal Postgres is shared only for now.

Labels: `project-management`


### `www-qw54.3` - Stream workflow logs in ticket detail
_P2 · feature · in_progress_

Let the Project Management ticket detail drawer show live stdout/stderr for the current workflow run, sourced from the persisted log chunks rather than directly from local files.

**Acceptance:**

- [ ] Detail drawer exposes a live log panel for workflow tickets with an active or archived run.
- [ ] The log panel distinguishes stdout from stderr visually.
- [ ] The stream endpoint rejects unsafe/unknown ticket ids and returns ordered chunks for known tickets.
- [ ] The UI keeps existing log/prompt links as fallback.
- [ ] Tests cover stream ordering, stdout/stderr separation, invalid ticket rejection, and archived-log rendering.
- [ ] From products/project-management, bun run test exits 0.
- [ ] From products/project-management, bun run typecheck exits 0.

Labels: `backlog`, `project-management`


### `www-qw54.5` - Show aggregate workflow token stats
_P2 · feature · in_progress_

Add top-level Project Management workflow stats for total OpenCode tokens and cost across all automated ticket workflow runs, visible on the Kanban/workflow page.

**Acceptance:**

- [ ] Kanban/workflow page shows aggregate total tokens spent across all stored automated ticket workflow runs.
- [ ] Kanban/workflow page shows aggregate total cost when cost data is available.
- [ ] Aggregate stats include at least input, output, reasoning, cache-read, and cache-write token breakdowns in the API response.
- [ ] Stats handle an empty database by showing an unavailable/zero state without crashing.
- [ ] Unit tests cover aggregate usage calculation and empty-state behavior.
- [ ] From products/project-management, bun run test exits 0.
- [ ] From products/project-management, bun run typecheck exits 0.

Labels: `backlog`, `project-management`


### `www-uq8c` - Simplify Project Management kanban cards
_P2 · task · in_progress_

Kanban cards in the Project Management UI currently repeat the workflow phase inside each card even though the column already communicates phase, expose confusing action labels like 'log log prompt', and show a bottom metadata/preview line that is visually noisy and unclear. Clean up the card summary so the column carries phase, card actions are understandable, and detailed-only controls stay out of the compact card.

**Acceptance:**

- [ ] Compact kanban cards no longer render the phase/status label such as shipped, builder, or task-phase text inside the card body/header.
- [ ] Compact kanban cards no longer render the ambiguous bottom metadata/preview text line shown under the timestamp/status row.
- [ ] Detailed ticket view still exposes the existing log/prompt-related actions, but their button labels are rewritten to be clear and human-readable.
- [ ] Kanban column grouping and card click/open behavior remain unchanged.
- [ ] Relevant Project Management UI tests or Storybook stories are updated, or a focused manual verification note is added to the ticket if no coverage exists.

Labels: `project-management`, `ticket-human`


## ci (6)

### `www-cred` - GITOPS GAP: infra/cloudflare Pulumi project not deployed by CI
_P1 · task_

The cloudflare tunnel/DNS/Access config lives in its own Pulumi project (control-center-cloudflare, infra/cloudflare) which CI does NOT deploy (the deploy job only runs pulumi up on the main workload infra). Same gitops gap as infra/unifi. Consequence (found in www-kbiy): route/access code changes land on main + pass gates but never reach the live tunnel, so cloudflared keeps serving stale ingress. The stack is also still marked ADOPT-ONLY/do-not-apply in program.ts from its import milestone. Wire it into CI (or a gated deploy lane) so route changes converge to prod like workloads do.

**Acceptance:**

- [ ] CI (or a gated job) runs pulumi up on control-center-cloudflare on relevant changes
- [ ] program.ts adopt-only/do-not-apply guard comments resolved (it's a real deploy path now that bosun is gone)
- [ ] a route/host change on main converges to the live tunnel without manual pulumi up

Labels: `ci`, `infra`


### `www-lzus` - Add source-hash image identity implementation ticket from stale-image decision
_P1 · task_

Implement the recommended option from www-ljoq once accepted: compute per-image source hashes and deploy images by current-main source identity rather than mutable :main when path filters skip builds.

**Acceptance:**

- [ ] Shared CI step computes source hash per image from product dir, imported packages, and bun.lock
- [ ] Build uses hash tag and skips only when ghcr:<hash> exists
- [ ] Deploy pins current-main hash digest for every service
- [ ] Regression covers test-failure-then-non-product-fix stale image case
- [ ] CI/docs updated

Labels: `ci`, `deploy`


### `www-bv5s` - Fix biome silently checking 0 files inside worktrees
_P2 · chore_

Found during CC-hn1i: biome.json files.includes has '!**/.claude', and linked worktrees live at .claude/worktrees/<name>/, so from inside ANY worktree 'bunx biome check .' matches zero files and exits 0. Every /finish-ticket biome gate run from a worktree has been a silent no-op; lint regressions only get caught by CI's biome step after merge. CC-hn1i worked around it with a temp config (sed the exclusion out, --config-path /tmp). Needs a structural fix so the gate is real at the worktree boundary.

**Acceptance:**

- [ ] bunx biome check . inside a .claude/worktrees/* checkout actually lints the worktree's files (non-zero file count)
- [ ] A biome run that processes 0 files fails loud in the /finish-ticket gate context (no silent exit-0 pass)
- [ ] Root cause addressed at config level: files.includes '!**/.claude' no longer swallows linked worktrees (e.g. scope the exclusion to '!.claude' relative root, or move worktrees out of .claude, or vcs-integration), not a per-skill workaround
--- auto-appended from DoD by type ---
- [ ] The fix demonstrated running (biome file-count output from inside a worktree)
- [ ] Gates: bun run test + typecheck + bunx biome check green
- [ ] No fake data (check-fake-data guard green)
- [ ] Committed chore(ci/CC-xxx); worktree→main merged + pushed; bd closed

Labels: `ci`


### `www-gu5t` - Make biome gate worktree-safe: 'bunx biome check .' silently checks ZERO files under .claude/worktrees
_P2 · chore_

**Acceptance:**

- [ ] Running the biome gate from inside a .claude/worktrees/<wt> checkout actually checks the workspace files (today biome ignores the path because the worktree lives under a hidden .claude dir and exits 0 having checked nothing - a silent gate hole in /finish-ticket and ship validators)
- [ ] Root cause documented in the fix (biome hidden-dir/scanner ignore semantics)
- [ ] /finish-ticket + ship validator gate commands updated if the fix is invocation-side (explicit paths) rather than config-side
- [ ] Gates: bun run test + typecheck + bunx biome check green
- [ ] No fake data (check-fake-data guard green)
- [ ] Committed chore(ci/CC-xxx); worktree→main merged + pushed; bd closed

Labels: `ci`


### `www-vn6d` - Make biome check work (or fail loudly) inside .claude worktrees
_P2 · chore_

**Acceptance:**

- [ ] bunx biome check . inside a .claude/worktrees/* checkout either checks the worktree files or fails with a clear actionable message (not a silent 'No files were processed')
- [ ] Worktree lifecycle docs/skills updated with the supported invocation
--- auto-appended from DoD by type ---
- [ ] The tool/config is demonstrated running (gate output)
- [ ] Gates green; committed chore(ci/CC-xxx); merged + pushed; bd closed

Labels: `ci`


### `www-dr4v` - ship v2 (full): worktree-per-feature isolation + perspective-diverse validators
_P3 · feature_

Deferred from CC-w6j2.6 (which did the minimal alignment: ship now references docs/ticket-standards.md and uses type(area/CC-xxx) commits). The heavier rewrite, to be built against a real ship run rather than on spec: (1) build each feature in its own ticket-id-led worktree (agent isolation:'worktree') so parallel features don't collide on main; (2) split the single scrutiny judge into perspective-diverse validators (correctness / no-fake-data / screenshot-evidence) per the Workflow adversarial-verify pattern; (3) make the per-milestone gate identical to /finish-ticket and merge each worktree to main (no PR) explicitly.

**Acceptance:**

- [ ] ship.mjs builds each feature via an isolation:'worktree' agent named CC-id-led; no two features share a working tree
- [ ] milestone validation uses >=3 perspective-diverse adversarial agents (correctness, no-fake-data, screenshot-evidence) instead of one scrutiny judge
- [ ] each feature's worktree merges to main (no PR) on green, matching /finish-ticket
- [ ] a dry-run on a small real epic completes without manual intervention
- [ ] Gates green; committed feat(ci/CC-xxx); worktree→main merged + pushed; bd closed

Labels: `ci`


## spike (6)

### `www-a6pu` - Spike: evaluate Effect (effect-ts) to replace existing TS code
_P0 · decision_

**Acceptance:**

- [ ] Survey current code that Effect could replace: tRPC service error handling (services THROW pattern), worker runtime try/catch + retry/scheduling (apps/worker/src/runtime.ts), QueryClient infinite-retry, async orchestration in cycles
- [ ] Prototype 1-2 representative modules ported to Effect (e.g. a service + the worker runtime) on a throwaway branch; measure LOC delta, type-safety gain, readability
- [ ] Assess cost: bundle size, learning curve, interop with tRPC/React/existing patterns, build/test impact
- [ ] Decision recorded (bd decision) with recommendation (adopt / partial-adopt / reject) + rejected alternatives + rationale
- [ ] Follow-up tickets filed for any adoption work (migration epic if adopt)

Labels: `spike`


### `www-azu2` - Spike: standardize service API layer (tRPC vs REST) + API-explorer/OpenAPI tooling across CC + TYE
_P0 · decision_

**Acceptance:**

- [ ] Decision recorded (bd decision/note): standardize the service API layer on tRPC, REST, or a hybrid across control-center (tRPC, @trpc/server v11) + text-your-ex (Hono REST) + future services; with rationale + rejected alternatives
- [ ] Native-Swift consumability weighed (REST/OpenAPI is friendlier than the tRPC wire format for the iOS clients) and factored into the decision
- [ ] API-explorer / spec tooling evaluated and a choice recorded:
    - [ ] tRPC-native: trpc-panel (auto-UI from router+zod, fastest to stand up), trpc-playground (in-browser client editor), trpc-ui
    - [ ] OpenAPI-from-tRPC: trpc-openapi / newer trpc-to-openapi (annotate .meta({openapi}), emits OpenAPI 3 + REST routes); check tRPC v11 first-party OpenAPI status
    - [ ] OpenAPI renderers compared: Scalar (@scalar/hono-api-reference), Swagger UI (@hono/swagger-ui), Redoc, Stoplight Elements
    - [ ] Hono path for tye-api: @hono/zod-openapi (zod-defined routes -> free spec) + a renderer
- [ ] Synergy assessed with the shared-zod /diagnostics work (www-fv57 / www-gtgd): an OpenAPI spec falls out of that shared schema almost for free; note whether to sequence the spike after/with it
- [ ] Recommendation lands on one consistent API-explorer style across both apps (fits the "standardize on apps" goal)
- [ ] Follow-up implementation tickets filed for the chosen direction

Labels: `spike`


### `www-jmpp` - Spike a better ship workflow (replace current ship.js)
_P2 · decision_

Recreated after dolt sync loss (original created 2026-06-09, wiped by failed dolt push + reset pull).

**Acceptance:**

- [ ] Decision recorded: concrete failings of current .claude/workflows/ship.js
- [ ] Proposed design documented (orchestration shape, validation model, model tiers, resumability)
- [ ] Rejected alternatives documented with rationale
- [ ] Migration/cutover path noted
- [ ] Follow-up implementation ticket(s) filed

Labels: `spike`


### `www-vo2q` - Spike: evaluate Capacitor native superpowers for the wall panel (OTA live updates, background runner, Live Activities)
_P2 · decision_

**Acceptance:**

Investigate the standout Capacitor plugins surfaced 2026-06-09 and decide which (if any) to adopt for the apps/web Capacitor app on the iPad wall panel. Spike = recorded decision, not code.

Candidates, in rough fit-for-a-wall-panel order:
1. **OTA live updates** - @capgo/capacitor-updater (https://github.com/Cap-go/capacitor-updater). Highest value here: push JS/HTML/CSS to the wall-mounted iPad with no rebuild/reinstall/App Store review. Evaluate self-hosted vs Capgo cloud, channels + rollback, fit with our deploy pipeline + CI.
2. **Background runner** - @capacitor/background-runner (https://github.com/ionic-team/capacitor-background-runner). Standalone JS engine for background fetch/notifications outside the webview. Could refresh tile data when the panel is idle/backgrounded.
3. **App Attest / device attestation** - capacitor-app-attest. Only if the panel ever calls protected backend APIs.
4. **iOS Live Activities + Dynamic Island** - capacitor-live-activities (https://github.com/Cap-go/capacitor-live-activities). Lower fit for an always-on kiosk, but note if there's a use.
5. **Home-screen widgets / Apple Watch** - capacitor-widget-bridge, capacitor-watch. Likely N/A for a wall kiosk; record as rejected with reason.

Spike DoD (per docs/ticket-standards.md):
- [ ] Decision recorded (bd decision or ticket note) with rationale
- [ ] Rejected alternatives captured with the why (esp. widgets/Watch/Live Activities if they don't fit the kiosk)
- [ ] Per-candidate notes: effort, risk, native-target changes needed
- [ ] Follow-up work filed as new tickets (e.g. "adopt capacitor-updater for OTA")
- [ ] Timebox: 1 day

Labels: `spike`


### `www-6ppt` - Decide how to reorganize secret management (scripts/secret/ vs interactive op-backed tool)
_P3 · decision_

**Acceptance:**

- [ ] Survey current state: 11 scripts/save-*.sh at repo root, each hand-rolled, all op-backed (Homelab vault)
- [ ] Evaluate options: (a) consolidate into scripts/secret/ with a shared lib/template, (b) a single interactive secret manager CLI (golang or bun) that wraps op (list/save/rotate items, drives the save-script pattern), (c) keep as-is
- [ ] Decision recorded (bd decision or ticket note) with rationale + rejected alternatives
- [ ] Follow-up implementation tickets filed for the chosen option

Labels: `spike`


### `www-rylf` - Spike: real DNS query names in the NAS log archive
_P3 · decision_

Verified 2026-06-09: UniFi's 'Additional Flows -> Gateway DNS' toggle feeds on-box Insights only - no port-53 records ride the IPFIX export to the NAS, so queried names never reach the archive. Current enrichment (CC-cs0o) gives reverse-DNS + ASN, which fuzzes on CDNs. Calum: park for now, readdress later; no preferred option yet.

**Acceptance:**

- [ ] Decision recorded: how (or whether) to capture actual DNS query names per device into /volume1/Unifi/logs
- [ ] Options evaluated: (1) dnsmasq query logging on the UCG Fiber (rides existing syslog stream; hand-applied, may not survive firmware updates), (2) own resolver on the NAS (AdGuard Home/Pi-hole; full logs + ad-blocking, bigger change), (3) stay with rDNS enrichment, or something else entirely
- [ ] Rejected alternatives documented with rationale
- [ ] Follow-up implementation ticket(s) filed if proceeding

Labels: `spike`


## refactor (5)

### `www-rfe7.3` - Replace as never casts in infra component with structural type bridge
_P2 · task_

**Acceptance:**

- [ ] infra/src/component.ts has zero as never casts
- [ ] A structural type bridges render.ts output to @pulumi/kubernetes input types
- [ ] ScheduledJob PVs have deleteBeforeReplace consistent with Workload
- [ ] bun run typecheck green
- [ ] bunx biome check . clean
- [ ] Committed refactor(infra/CC-xxx); worktree→main merged + pushed; bd closed

Labels: `refactor`


### `www-rfe7.6` - Deduplicate INTERACTIVE_SELECTOR constant
_P2 · task_

**Acceptance:**

- [ ] INTERACTIVE_SELECTOR defined in exactly one place
- [ ] Board.tsx and useBoard.ts both import from shared source
- [ ] bun run test green
- [ ] bun run typecheck green
- [ ] bunx biome check . clean
- [ ] Committed refactor(web/CC-xxx); worktree→main merged + pushed; bd closed

Labels: `refactor`


### `www-rfe7.8` - Extract Board.tsx internal components and experiment harness
_P2 · task_

**Acceptance:**

- [ ] FpsMeter, BuildHashBadge, SnapModeSwitcher extracted to components/board/
- [ ] getVisibleTiles moved from hooks/useBoard.ts to lib/
- [ ] Board.tsx still renders correctly
- [ ] bun run test green
- [ ] bun run typecheck green
- [ ] bunx biome check . clean
- [ ] Committed refactor(web/CC-xxx); worktree→main merged + pushed; bd closed

Labels: `refactor`


### `www-rfe7.12` - Lazy-import pino-pretty and simplify redaction list
_P3 · task_

**Acceptance:**

- [ ] pino-pretty lazy-imported inside pretty branch, not at module level
- [ ] Redaction list uses wildcard-only entries (no duplicated *./ patterns)
- [ ] bun run test green
- [ ] bun run typecheck green
- [ ] bunx biome check . clean
- [ ] Committed refactor(logger/CC-xxx); worktree→main merged + pushed; bd closed

Labels: `refactor`


### `www-rfe7.7` - Replace mount() dummy ref objects with honest secretsToMount field
_P3 · task_

**Acceptance:**

- [ ] WorkloadSpec.secrets replaced by WorkloadSpec.secretsToMount: string[]
- [ ] mount() function removed or returns honest type
- [ ] Media-worker env divergence from haEnv documented
- [ ] bun run typecheck green
- [ ] bunx biome check . clean
- [ ] Committed refactor(infra/CC-xxx); worktree→main merged + pushed; bd closed

Labels: `refactor`


## infra (3)

### `www-j934` - Migrate deploy stack to Pulumi + k3s and remove bosun
_P1 · epic_

Replace bosun+Docker Swarm with Pulumi (TS, in-monorepo infra/) + OrbStack Kubernetes on homelab. Scope: Pulumi foundation (Pulumi Cloud state, op-sourced creds, ComponentResource vocabulary succeeding service()/cronJob()); CF Access + tunnel routes re-homed to the pulumi-cloudflare provider; cluster spikes FIRST (LAN-exposure toggle reaches iPad; NFS-from-pod no hang - either failing reopens platform choice); all services moved (api, worker, media-worker, web, storybook, captive-portal, drizzle, cloudflared in-cluster 2 replicas; CNPG Postgres on local-path PVC, pg_dump migration with per-table row-count verification, old pgdata kept as rollback, NEW nightly backups to NAS); crons re-homed (image-prune DELETED in favor of kubelet GC, cert-renew → cert-manager CF DNS-01, portal-data-purge + map-extract → k8s CronJob); secrets via External Secrets Operator + 1P SDK provider (service-account token, native Secrets mounted at existing /run/secrets/<NAME> paths, zero image changes); UniFi under filipowm/unifi ADOPT-ONLY (pulumi import everything existing, protect:true, first preview must show ZERO diffs; walled-garden + NetFlow stay unmanaged/direct-API) + NEW isolated www-guest VLAN (own subnet/VLAN id, guest policy, cross-VLAN path to portal host verified); CI deploy rework (GH Actions builds → digests → pulumi up over ephemeral Tailscale key; build-bosun/mark-deployed/deploy-drift retired); cutover = move tunnel token in-cluster, downtime OK, ZERO data loss; full bosun removal per recon checklist (code, 7 Dockerfile COPYs, vitest/knip/biome/package.json entries, CI jobs, docs rewrites incl. deployment-design.md + CLAUDE.md, bd memories, 1P 'Bosun Webhook Token', logger redact entry); Portainer retired. Host layer stays launchd (HA qemu VM, socat proxies, NFS mount daemon, orbstack-watchdog). OUT of scope v1: Hetzner cluster, HA YAML-as-code, NAS/DSM provider (needs DSM 7.2), Tailscale ACLs, GitHub-repo-as-code. First child deliverable: design doc docs/k3s-migration.md. AC = all children closed or deferred.

Labels: `infra`


### `www-j934.11` - Prod verification: dashboard tiles, Access gates, portal LAN+TLS, UniFi byte-unchanged
_P1 · feature_

**Acceptance:**

- [ ] agent-browser @1366x1024 against https://dashboard.worldwidewebb.co: screenshot every tile, STATE what each shows (real weather/lights/network/etc.), console clean of new errors
- [ ] Lights flow: toggle a lamp from the dashboard and confirm desired-state reconciliation (surface api/DB evidence)
- [ ] storybook + drizzle still 302 to Cloudflare Access login when unauthenticated (surface curl -I); hooks.worldwidewebb.co route retired
- [ ] Captive portal reachable on the LAN over TLS with the cert-manager cert (surface curl from a LAN device)
- [ ] www-guest VLAN + SSID exist in UniFi (surface controller GET) with the isolated network per DESIGN.md; world-wide-webb, rsyslog, netflow configs BYTE-UNCHANGED vs RECON.md (surface the GETs)
- [ ] On-device guest OTP flow (CC-q002.17) needs Calum present: needs-input for that single step, never faked

Labels: `infra`, `milestone-5`


### `www-0y64` - Normalize product database resource names
_P2 · epic_

Why this issue exists: product namespaces now carry product identity, but CNPG database resource names still repeat the product slug inside those namespaces. That produces confusing objects such as text-your-ex/text-your-ex-1 and captive-portal/captive-portal-rw. What needs to be done: move product DB primitives and live product DBs to namespace-local postgres naming, migrate existing data safely, and remove temporary legacy overrides.

Labels: `infra`, `platform`


## area:opencode/plugin-lab (2)

### `www-iy13` - OpenCode plugin lab
_P2 · epic_

Build a local OpenCode plugin lab that proves safe TUI sidebar plugins, server command/event plugins, shared file-backed state, native attention/sound notifications, honest context diagnostics, and a later plugin-manager/hot-reload experiment. TUI plugins must be registered from .opencode/tui.json, not auto-discovered from .opencode/plugins. Server plugins stay in .opencode/plugins. Shared cross-runtime state lives under ~/.local/state/opencode-plugin-lab/ or a clearly documented local state path. The user prefers to stay mostly out of the loop; verification should be automated where possible by launching OpenCode in tmux/cmux and using short waits around 5s.

**Acceptance:**

- [ ] All child issues are closed or explicitly deferred.

Labels: `area:opencode/plugin-lab`, `opencode/plugin-lab`


### `www-iy13.8` - Spike plugin manager and hot reload UX
_P3 · decision_

Investigate a plugin lab manager route and practical hot reload workflow after the stable plugin path works.

**Acceptance:**

- [ ] Decision records what OpenCode built-in plugin manager already provides.
- [ ] Decision tests api.plugins.list/activate/deactivate/add against local file plugins.
- [ ] Decision records whether same-path hot code reload is reliable or requires path/version changes/restart.
- [ ] Decision proposes the smallest useful plugin-lab manager UX, or rejects building one for now.
- [ ] Follow-up implementation tickets are created if the spike recommends more work.
- [ ] Decision is recorded in the ticket notes or design field with rationale and rejected alternatives.

Labels: `area:opencode/plugin-lab`, `opencode/plugin-lab`


## auth (2)

### `www-o2wv` - Replace TYE Apple Sign In with native Swift implementation
_P1 · epic_

Parent epic for replacing the failing Text Your Ex @capacitor-community/apple-sign-in integration with a custom native Swift Capacitor plugin, correlated frontend/native/backend diagnostics, and a real plugged-in iPhone proof path. AC is all children closed or deferred.

Labels: `auth`, `ios`, `manual`, `tye`


### `www-o2wv.2` - Add correlated Apple auth diagnostics across TYE web and API
_P1 · bug_

**Acceptance:**

- [ ] Frontend calls the custom native plugin through a typed local wrapper, not directly from `Onboarding.tsx`.
- [ ] Frontend diagnostic panel shows `attemptId`, native error code/domain, and API status without exposing tokens.
- [ ] Apple `1001` / cancellation maps to a friendly "sign-in was not completed" path.
- [ ] `/api/auth/apple` accepts and logs `attemptId`, `state`, `nonce`, and safe Apple token metadata.
- [ ] API verifies Apple JWT issuer, audience, expiry, signature, and nonce.
- [ ] API logs never include identity token, authorization code, session token, raw email, full name, or raw Apple `sub`.
- [ ] API tests cover missing token, malformed token, wrong audience, nonce mismatch, valid token, new user, and existing user.
- [ ] Frontend tests cover native success, native cancel, native failure, API rejection, non-native web path, and double-submit guard.
- [ ] Regression test is red before the fix and green after.
- [ ] Gates: `bun run test` + `bun run typecheck` + `bunx biome check .` green.
- [ ] No fake data, `check-fake-data` guard green.
- [ ] Committed `fix(auth/www-xxx): ...`; PR to `main` merged; bd closed.

Labels: `auth`, `ios`, `manual`, `tye`


## auto (2)

### `www-3x1s` - Show ticket workflow token totals
_P3 · feature · in_progress_

Replacement for www-qw54.4, which was closed as shipped but recorded the same broad refactor commit as unrelated tickets (83d5c424 refactor project-management temporal workflow inputs). Track OpenCode token and cost usage per ticket workflow run and show completed-ticket totals in the Project Management detail view.

**Acceptance:**

- [ ] Workflow completion captures OpenCode cost and token fields for builder, reviewer, and merge-fix sessions when a session id is known.
- [ ] Usage capture is idempotent by opencode_session_id and does not fail the workflow if OpenCode usage is temporarily unavailable.
- [ ] /api/board-data includes per-ticket total tokens, cost, and per-run usage breakdown for workflow tickets.
- [ ] Completed ticket detail shows total tokens used by the ticket workflow.
- [ ] Unit tests cover OpenCode session row parsing, idempotent usage upsert, and per-ticket aggregation.
- [ ] From products/project-management, bun run test exits 0.
- [ ] From products/project-management, bun run typecheck exits 0.

Labels: `auto`, `project-management`, `ticket-human`


### `www-w9do` - Set Project Management web app page title
_P3 · task · in_progress_

Replacement for www-p418, which was closed with suspicious shipped metadata: the recorded ticket_commit a4c78d0e is only a test commit, while the notes cite a separate implementation commit. Re-check and, if still missing or fragile, set the Project Management web app browser document title to "Project Management UI" in the correct app entry point.

**Acceptance:**

- [ ] Project Management web app sets document/page title to "Project Management UI".
- [ ] The title is applied in the correct app entry point/layout so normal routes inherit it.
- [ ] Existing tests are updated or added to assert the title is present in the served app entry point.
- [ ] From products/project-management, bun run test exits 0.
- [ ] From products/project-management, bun run typecheck exits 0.

Labels: `auto`, `project-management`, `ticket-human`, `ui`


## beads (1)

### `www-bu5s` - Beads dolt working set rolled back: uncommitted tickets silently lost
_P1 · bug_

**Acceptance:**

- [ ] Root cause identified for the 2026-06-09 ~17:00-21:00 rollback that deleted uncommitted issues (CC-e017/CC-wvmo/CC-ota4/CC-dhi9) while dolt-server logged repeated 'cannot merge with uncommitted changes' and failed refs/dolt/data pushes ('this operation must be run in a work tree' from a worktree cwd)
- [ ] bd dolt pull/push from a git worktree cwd either works or fails loudly without destroying the working set
- [ ] Regression-test or guard prevents silent working-set loss
--- auto-appended from DoD by type ---
- [ ] regression test red-before / green-after
- [ ] Gates: bun run test + typecheck + bunx biome check green
- [ ] Committed fix(beads/CC-xxx); merged + pushed; bd closed

Labels: `beads`


## bosun (1)

### `www-xspd` - Re-enable media-worker (YouTube download worker): fix OrbStack↔NFS mount, flip replicas 0→1
_P2 · task_

**Acceptance:**

- [ ] Root cause fixed: OrbStack bind-mount of the NFS media share (/Users/calum/control-center/media) no longer hangs - a throwaway `docker run -v /Users/calum/control-center/media:/m alpine ls /m` starts and exits in <5s on homelab
- [ ] `deploy.config.ts` media-worker `replicas` flipped 0→1 (and the stale CC-6mz7 reference in the comment updated to this ticket id, since CC-6mz7 was never a real ticket)
- [ ] media-worker task running on homelab: `docker service ps control-center_media-worker` shows 1/1 Running, no restart loop, no cloudflared/1033 outage triggered
- [ ] End-to-end: an enabled media_source poll enqueues a youtube_ingest job and yt-dlp downloads at least one item to the NAS (row in media_items + file on disk)
- [ ] 1G memory cap retained (the OOM/RCU-stall fix from CC-ke9a must stay)
- [ ] Gates green (test+typecheck+biome), no fake data, committed type(bosun/CC-xxx), worktree→main merged + pushed, bd closed

Labels: `bosun`


## captive-portal (1)

### `www-q002.28` - Investigate getting captive-portal.worldwidewebb.co (hostname+HTTPS) to render in the Apple captive sheet
_P3 · task_

Follow-up to CC-q002.26. The captive portal now works on real devices via a raw-IP HTTP landing (portal_use_hostname=false), because the Apple Captive Network Assistant renders + runs JS over http://192.168.0.147/ but will NOT render the same page at https://captive-portal.worldwidewebb.co/ (or http hostname). Extensive elimination (CC-q002.26 session) proved it is purely the hostname-vs-IP URL form: the CNA reached our .147 nginx via the hostname and got 200 + valid LE cert + uncompressed HTML, but rendered nothing (not even a plain <img> or <noscript>); the identical trivial page at the raw IP rendered AND ran JS. This is consistent with Apple treating real-domain captive pages under stricter rules (ATS / captive heuristics) than local IPs, which is why commercial captive portals use IPs. Worth a bounded investigation to see if hostname+HTTPS is recoverable (nicer UX), but raw-IP is the standard fallback and is shipped. Low priority.

**Acceptance:**

- [ ] Determine WHY the Apple CNA renders the raw-IP HTTP captive page but not the same page served from the real domain (captive-portal.worldwidewebb.co), both reach the same nginx at .147 with identical content; ruled out: DNS-reaches-server, cert validity, gzip, page content
- [ ] Test the leading hypotheses: App Transport Security / ATS cipher+cert requirements over HTTPS, HSTS forcing an upgrade, a redirect chain on the hostname, and the public *.worldwidewebb.co Cloudflare record confusing the CNA resolver
- [ ] If a fix exists (e.g. ATS-compliant TLS, removing the public record so the name is local-only, killing any redirect), switch the UniFi portal back to portal_use_hostname=true + HTTPS and verify the captive sheet renders on a real iPhone AND MacBook
- [ ] If no fix is found, document the conclusion (Apple deliberately will not render real-domain captive pages) so this is not re-litigated

Labels: `captive-portal`


## cleanup (1)

### `www-0y64.5` - Remove legacy product-slug DB names after soak
_P2 · task_

Why this issue exists: temporary migration overrides and old product-slug CNPG resources must not become permanent architecture. What needs to be done: after successful soaks, remove legacy clusters/PVCs/overrides and add guards so product-slug DB names cannot reappear.

**Acceptance:**

- [ ] No steady-state product manifest passes clusterName, rwServiceName, or product-prefixed DB service overrides
- [ ] kubectl checks show no text-your-ex/text-your-ex-* CNPG pod/service/PVC names except app-local names unrelated to DB
- [ ] kubectl checks show no captive-portal/captive-portal-* CNPG pod/service/PVC names except app-local names unrelated to DB
- [ ] Rendered manifest tests fail on text-your-ex-rw, captive-portal-rw, text-your-ex-1, or captive-portal-1 after cleanup
- [ ] Docs state the invariant: namespace carries product identity, DB names inside namespaces are local
- [ ] Old product-slug CNPG clusters/PVCs are deleted only after the documented rollback window and validation evidence
- [ ] Gates green: bun run test + bun run typecheck + bunx biome check .
- [ ] No fake data, check-fake-data guard green
- [ ] Committed as type(infra/www-xxx): desc, worktree→main merged + pushed, bd closed

Labels: `cleanup`, `infra`, `platform`


## control-center (1)

### `www-3g46` - Require latest iOS app build before use
_P4 · feature_

**Acceptance:**

- [ ] Text Your Ex reads its installed native build number at startup.
- [ ] Control Center reads its installed native build number at startup.
- [ ] Each app compares installed build number against a server-controlled latest-required build number.
- [ ] If installed build is older than latest-required, the app blocks normal use with an update-required screen.
- [ ] Update-required screen explains the app is out of date and points the user to TestFlight/App Store.
- [ ] If the latest-required build cannot be fetched, existing app behavior continues without a hard block.
- [ ] Build freshness check is covered by frontend/native-boundary tests for current, stale, and fetch-failure states.
- [ ] Gates: bun run test + typecheck + bunx biome check green.
- [ ] No fake data (check-fake-data guard green).
- [ ] Committed feat(ios/update/www-xxx); PR to `main` merged; bd closed.

Labels: `control-center`, `ios`, `ios/update`, `tye`


## devx (1)

### `www-k6j6` - Dev environment reachable from iPad for live testing
_P1 · feature_

Stand up a way to hit a running dev build of control-center from the iPad (wall panel) for occasional hands-on testing, without deploying to prod. Today the only live target is prod (dashboard.worldwidewebb.co via the Swarm stack); there's no dev surface to poke at from the iPad.

Options to evaluate (cheapest/simplest first):
1. Tailscale-only (likely sufficient, ~zero cost): run the Tilt dev stack on the MacBook (or homelab), and hit it from the iPad over the tailnet at http://<device>:<port> (e.g. calums-macbook:5173 for web / :4201 api). Both iPad and MacBook are already on the tailnet (calums-ipad-pro, calums-macbook). Need: bind Vite/api dev servers to 0.0.0.0 (not just localhost) so they're reachable over the tailnet, and confirm MagicDNS name resolves. Possibly a Tailscale Serve to get HTTPS + a stable name.
2. A persistent 'dev' surface on homelab: a second Swarm stack / compose project (dev.worldwidewebb.co) tracking a dev branch or manual deploy, behind the existing Cloudflare tunnel. More setup, always-on.
3. Cloud dev box (Hetzner/etc.): only if local options prove insufficient. Cost + another machine to manage.

Decide the approach, implement the minimal viable one, and document it (host file table / README) so it's reproducible. Lean toward option 1 if it works.

**Acceptance:**

- A documented, repeatable way to open a live dev build of the web app on the iPad (calums-ipad-pro) over the tailnet, NOT prod.
- The web dev server binds to an address reachable over Tailscale (0.0.0.0 or Tailscale Serve), and /api requests proxy to the dev api (no CORS breakage).
- Verified by actually loading the board on the iPad at 1366x1024 and confirming at least one live tile renders against the dev api.
- The setup (commands / Tiltfile change / Tailscale Serve config) is written down in the repo (README or docs + host file table) so future sessions can reproduce it.
- Chosen approach + rejected alternatives recorded (decision note).

Labels: `devx`, `infra`


## infra/unifi (1)

### `www-q002.27` - Codify UniFi guest network name as guest
_P1 · bug_

Live UniFi now uses network object name 'guest' with SSID 'www-guest' and VLAN ID 20. infra/unifi still declares the network resource name as 'www-guest', so a future Pulumi refresh/apply may drift or rename the live object back. Codify the distinction so controller desired state matches reality.

**Acceptance:**

- [ ] infra/unifi desired state uses UniFi network name `guest` while keeping SSID `www-guest` and VLAN ID `20`
- [ ] Tests cover network name distinct from SSID and preserve VLAN 20
- [ ] docs/captive-portal/runbook.md distinguishes UniFi network name `guest` from SSID `www-guest`
- [ ] Pulumi refresh/apply notes verify no rename drift before apply
--- auto-appended from DoD by type ---
- [ ] Regression test red-before / green-after
- [ ] Gates: bun run test + typecheck + bunx biome check green
- [ ] No fake data (check-fake-data guard green)
- [ ] Committed fix(infra/unifi/CC-xxx); worktree→main merged + pushed; bd closed

Labels: `infra/unifi`


## milestone-6 (1)

### `www-q002.17` - Production cutover: real-device validation on the guest WLAN
_P1 · task_

Area: captive-portal. PRD: docs/captive-portal/PRD.md. The only ticket needing Calum physically present with a phone.

**Acceptance:**

- [ ] A real phone on the guest SSID is captive-redirected to the portal, completes the full flow with a real email, and gets internet for 30 days (authorization row + controller state verified)
- [ ] Success redirect to the original URL works; rejoin short-circuits to AlreadyConnected
- [ ] Evidence attached to the ticket (photos/log excerpts); found issues filed as child bugs
- [ ] Harden audit: memories/rules/guards proposed and filed
- [ ] Gates green; any fixes committed per lifecycle; bd closed

Labels: `milestone-6`


## ops (1)

### `www-humj` - Repair beads dolt sync: local/origin refs/dolt/data diverged, push rejected (cancelled by force)
_P1 · chore_

bd dolt push fails with 'push cancelled by force' (non-fast-forward) even after bd dolt commit + pull; pull intermittently fails with 'cannot merge with uncommitted changes'. Local data intact and AHEAD of origin (CC-5mek close, CC-gu5t, memories unsynced). Until repaired, every fresh local row is exposed to the documented vanish race. Manual runs also hit dolt's git subprocess erroring 'this operation must be run in a work tree' in some invocations. Area: ops.

**Acceptance:**

- [ ] 'bd dolt push' from the main checkout succeeds (exit 0) and 'git ls-remote origin refs/dolt/data' hash moves
- [ ] Root cause of the divergence documented (suspected: 2026-06-09 session where post-merge 'bd dolt pull' reported 'database CC not found', a fresh issue row vanished, and histories forked; see memory beads-git-pull-race)
- [ ] Decide + document the reconcile strategy (merge vs deliberate force-push of local over origin) - shared history, so the decision is explicit, not automatic
- [ ] 'cannot merge with uncommitted changes' loop on 'bd dolt pull' diagnosed (something rewrites the dolt working set between bd dolt commit and pull)
- [ ] lefthook pre-push beads-sync warning surfaced more loudly than a swallowed timeout (today '✔️ beads-sync (90.05s)' displays as success even when the 90s timeout killed the push)

Labels: `ops`


## scripts (1)

### `www-0jk8` - Clean up scripts folder
_P2 · chore_

**Acceptance:**

- [ ] Retired portal LAN scripts, tests, plist, and CI references are removed or explicitly marked historical
- [ ] Save/operator scripts no longer mention bosun, Swarm, deploy.config.ts, or docker secrets as the active deploy path
- [ ] scripts/ has a README/index categorizing guard scripts, CI scripts, operator tools, and historical/deprecated scripts
- [ ] Relevant docs/comments point to Pulumi+k8s, ESO, and current homelab runtime paths
- [ ] Gates green (test+typecheck+biome), no fake data, committed chore(scripts/CC-xxx), worktree→main merged + pushed, bd closed

Labels: `scripts`


## web (1)

### `www-czbf` - Add Open in Temporal button to detailed ticket view
_P2 · feature_

**Acceptance:**

- [ ] Detailed ticket view renders an `Open in Temporal` action when the ticket has Temporal workflow/run metadata available
- [ ] Clicking the action opens the correct Temporal UI URL for that ticket in a new browser tab/window
- [ ] The action is hidden or disabled with an explanatory unavailable state when Temporal metadata is missing
- [ ] Existing detailed ticket view tests or stories cover available and unavailable Temporal states
- [ ] agent-browser screenshot @1366x1024 verifies the button in the detailed ticket view
- [ ] Gates: bun run test + typecheck + bunx biome check green
- [ ] No fake data (check-fake-data guard green)
- [ ] Committed feat(web/www-xxx); PR to `main` merged; bd closed

Labels: `web`


## www-web (1)

### `www-awm` - Title bar + notification center: thin top bar ('Home' left, bell right) with popover
_P2 · feature_

**Acceptance:**

A thin, unobtrusive title bar sits at the top of the fixed 1366x1024 board: 'Home' (or Control Center) label on the left, a notification bell on the right; tapping the bell opens a small popover/modal anchored from the bell listing active notifications; the bell shows an unread/active count or dot; the connection-lost notification (CC-dck) renders through this center instead of its own overlay once this lands; bar height + spacing respect the consistent-spacing scale and dark tokens (incl. scrollbar styling inside the popover if it scrolls); board tile grid reflows to sit below the bar without breaking the bento layout or any tile; story + vitest tests for open/close + count; gates green.

Labels: `www-web`

