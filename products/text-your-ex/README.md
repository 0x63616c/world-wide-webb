# Text Your Ex

> A shared guilt jar for friends trying not to text their exes.

You and your friends know who shouldn't be texting whom. Make a pact, throw your slip-ups
into a shared **jar**, and watch the guilt money pile up. Every time someone caves and texts
their ex, it gets logged. The tally grows. Your friends find out. Shame, but make it a leaderboard.

No real money moves (the "Settle up" button is intentionally inert), and detection is honor-system:
you log it yourself or a friend reports you.

![onboarding](docs/design-reference/project/shots/onboarding.png)

## Stack

| Layer | Tech |
|---|---|
| Web | React 18 + TypeScript + Vite, iPhone-framed web app + iOS Capacitor shell |
| API | Bun + Hono, Postgres (CNPG on k3s in prod, Docker for local dev) |
| Auth | "Sign in with Apple" (demo) + phone OTP (pretend) + bearer-token sessions |
| Tests | Vitest (API contract tests) + Playwright (E2E, requires Postgres) |
| Deploy | Two images: `Dockerfile.api` (Bun/Hono) + `Dockerfile.frontend` (nginx static) |

Money is stored as integer cents everywhere; the data model is Stripe-ready so real payments can
drop in later without a schema rewrite.

## Quick start (local dev with Tilt)

```bash
bun install
tilt up   # starts Docker Postgres (:5432) + API (:8787) + Vite dev server (:5173)
```

Open <http://localhost:5173>. Hit **Sign in with Apple** to log straight in as the demo user
(Calum), or **Continue with phone** to make a fresh account (the OTP screen accepts any 6 digits).

Demo invite code: **`XEX24K`** (The Group Chat).

## Scripts

| Command | What it does |
|---|---|
| `tilt up` | Full local stack (Postgres + API + Vite) |
| `bun run seed` | Seed demo data (dev only, no-op in production) |
| `bun run seed:reset` | Truncate + reseed (dev only) |
| `bun run build` | Build the web app to `apps/frontend/dist` |
| `bun run test:e2e` | Playwright E2E suite (requires DATABASE_URL) |
| `bun run ios:sync` | Build web + sync to Capacitor iOS |
| `bun run ios:open` | Open Xcode |
| `bun run ios:sim` | Live-reload simulator |

## Features

- **Jars** - named accountability groups with a rule, a per-slip cost, members and a running pot.
- **Slips** - self-log "I texted my ex" with an amount, optional private ex label, and a note.
- **Clean streak** - "days since I last texted my ex," opt-in to share per jar.
- **Reports** - flag a friend with text and/or screenshot evidence, optionally anonymously.
  The accused gets to own it (logs the slip) or deny it.
- **Wall of shame** - per-jar leaderboard sorted by tally, with streaks shown for sharers.
- **Invites** - share an invite code / link from any jar; join by code with a preview first.
- **Activity feed** - slips, reports, joins, and milestones ("the jar just cracked $100").
- **Profile** - edit name/avatar, per-jar share-streak toggles, notification preferences.

## Architecture

```
apps/
  api/
    src/
      db/
        migrations/   SQL files run in order on startup (_tye_migrations tracks applied)
        index.ts      pg Pool + buildDatabaseUrl() (DATABASE_URL wins, else POSTGRES_PASSWORD_FILE)
        migrate.ts    migration runner
      store.ts        all business logic (async, pool.query, positional $1/$2 params)
      api.ts          Hono routes (auth, me, jars, slips, reports, activity)
      auth.ts         bearer-token middleware
      env.ts          buildDatabaseUrl() (k8s ESO pattern + DATABASE_URL override)
      seed.ts         demo data; guards on APP_ENV=production (no-op) + users table empty
      index.ts        entry: runMigrations + ensureSeed + buildApp()
      server.ts       CORS allow-list (app--tye.worldwidewebb.co, localhost:*, capacitor://)
  frontend/           React + TS app (iPhone frame, 16 screens)
    src/
      api.ts          typed client (VITE_API_BASE baked at Docker build time)
  e2e/                Playwright specs (require DATABASE_URL, TYE_RESET=1 for clean run)
ios/                  Capacitor iOS kiosk shell
docs/                 product spec + design handoff (design-reference/)
```

The design is preserved under `docs/design-reference/` and the product spec under `docs/superpowers/specs/`.

## Production deployment

Two images, built by CI on push to main:

| Image | Dockerfile | Registry |
|---|---|---|
| `control-center-tye-api` | `Dockerfile.api` | `ghcr.io/0x63616c/` |
| `control-center-tye-frontend` | `Dockerfile.frontend` | `ghcr.io/0x63616c/` |

The API image sets `APP_ENV=production` (seed guard). The frontend image bakes `VITE_API_BASE`
at build time via `--build-arg VITE_API_BASE=https://api--tye.worldwidewebb.co`.

### Production acceptance checklist (www-jtp0.6.10)

Before TYE goes live, verify ALL of the following with Calum:

- [ ] `pulumi up` applied TYE CNPG cluster + API + frontend workloads
- [ ] `kubectl get pod -n text-your-ex` shows api + frontend Running
- [ ] `curl https://app--tye.worldwidewebb.co/api/health` returns `{"ok":true}`
- [ ] Browser: Sign in with Apple demo logs in as Calum, jars + slips visible
- [ ] Phone OTP flow: any 6 digits creates a new account
- [ ] Jar creation, slip log, anonymous report flow tested end-to-end
- [ ] Postgres backup CronJob fired and artifact present on NAS
- [ ] iOS TestFlight: remove `if: false` gate in `tye-ios-release.yml`, build completes
- [ ] TestFlight build installs on iPad, loads `https://app--tye.worldwidewebb.co`
- [ ] Production: `ensureSeed()` is a no-op (users table is empty, app starts clean)

## Not in v1

Real payments, payouts, committee voting on denied reports, push notifications (prefs exist but
don't dispatch), and on-device contacts integration are out of scope. Phone OTP is pretended
(any 6 digits works) so the flow is demoable without Twilio.
