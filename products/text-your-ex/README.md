# Text Your Ex

> A shared guilt jar for friends trying not to text their exes.

You and your friends know who shouldn't be texting whom. Make a pact, throw your slip-ups
into a shared **jar**, and watch the guilt money pile up. Every time someone caves and texts
their ex, it gets logged. The tally grows. Your friends find out. Shame, but make it a leaderboard.

This is a full-stack v1: a React iPhone-framed web app backed by a Bun + SQLite API. No real
money moves (the "Settle up" button is intentionally inert), and the "text your ex" detection is
honor-system - you log it yourself or a friend reports you. Every feature in the spec is built and
covered by an end-to-end test.

![onboarding](docs/design-reference/project/shots/onboarding.png)

## Stack

| Layer | Tech |
|---|---|
| Web | React 18 + TypeScript + Vite, rendered inside an iOS device frame |
| API | Bun + Hono, SQLite (`bun:sqlite`) |
| Auth | "Sign in with Apple" (demo) + phone OTP (pretend - any 6 digits) + bearer-token sessions |
| Tests | Playwright (11 E2E specs, every feature) |

Money is stored as integer cents everywhere; the data model is Stripe-ready so real payments can
drop in later without a schema rewrite.

## Quick start

```bash
bun install
bun run seed     # creates server/data/tye.sqlite with the demo jars + people
bun run dev      # web on :5173 (proxying /api), server on :8787
```

Open <http://localhost:5173>. Hit **Sign in with Apple** to log straight in as the demo user
(Calum), or **Continue with phone** to make a fresh account (the OTP screen accepts any 6 digits).

Demo invite code: **`XEX24K`** (The Group Chat).

## Scripts

| Command | What it does |
|---|---|
| `bun run dev` | Run web + server together (hot reload) |
| `bun run dev:server` / `bun run dev:web` | Run one half |
| `bun run seed` | Reset + reseed the database |
| `bun run build` | Build the web app to `web/dist` |
| `bun run start` | Production: server serves the built web app + API on one port |
| `bun run test:e2e` | Build web, then run the full Playwright suite |

## Features

- **Jars** - named accountability groups with a rule, a per-slip cost, members and a running pot.
- **Slips** - self-log "I texted my ex" with an amount, optional private ex label, and a note. The
  pot and your tally animate up; your clean streak resets.
- **Clean streak** - "days since I last texted my ex," opt-in to share per jar (ex-less members read
  "forever clean").
- **Reports** - flag a friend with text **and/or screenshot evidence**, optionally **anonymously**.
  The accused gets to **own it** (logs the slip) or **deny it** (drops it).
- **Wall of shame** - per-jar leaderboard sorted by tally, with streaks shown for sharers.
- **Invites** - share an invite code / link from any jar; join by code with a preview first.
- **Settle up** - shows what you owe, intentionally inert ("Payments coming soon").
- **Activity feed** - slips, reports, joins, and milestones ("the jar just cracked $100").
- **Profile** - edit name/avatar, per-jar share-streak toggles, notification preferences.

## Architecture

```
web/                 React + TS app (iPhone frame, 16 screens)
  src/
    api.ts           typed client for the API
    theme.ts ui.tsx  design tokens + primitives (true-black + gold)
    bits.tsx         toggle, stepper, evidence viewer, money burst
    iosframe.tsx     iOS 26 device bezel
    App.tsx          nav stack + tab bar + session boot
    screens/         one file per screen
server/
  src/
    db.ts            schema (users, jars, memberships, slips, reports, evidence, activity, sessions)
    store.ts         all business logic
    api.ts           Hono routes (auth, me, jars, slips, reports, activity)
    seed.ts          demo data (Calum, Ali, Giselle, Alyssa + their exes)
    index.ts         entry; serves web/dist in production
e2e/                 Playwright specs
docs/                product spec + the original design handoff (design-reference/)
```

The design this implements is preserved under `docs/design-reference/` (the Claude Design handoff
bundle) and the product spec under `docs/superpowers/specs/`.

## Deploy

The repo ships a single-image `Dockerfile` that builds the web app and serves everything from Bun:

```bash
docker build -t text-your-ex .
docker run -p 8787:8787 -v tye-data:/app/data text-your-ex
# → http://localhost:8787
```

Or without Docker, on any Bun host:

```bash
bun install
bun run build
bun run start          # serves web/dist + /api on $PORT (default 8787)
```

SQLite persists to `$TYE_DB` (default `/app/data/tye.sqlite` in Docker). See `.env.example`.

## Status / not in v1

Real payments, payouts, committee voting on denied reports, push notifications (prefs exist but
don't dispatch), and on-device contacts integration are deliberately out of scope for v1. The phone
"SMS" is pretended (any code works) so the flow is demoable without a Twilio key.
