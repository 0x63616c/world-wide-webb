# GOAL — Ship the Media/Entertainment Control Center (bd epic www-c2pc)

Use this file as a `/goal` condition: `/goal @docs/media-tiles/GOAL.md`.

Build, real-integrate, Storybook, and ship to PROD the 4 media tiles specified in
`docs/media-tiles/IMPLEMENTATION_HANDOFF.md`, then verify them live in a browser. Drive the
build with the **Workflow tool** (the `ship` workflow on epic `www-c2pc`, `push:true`),
parallelizing the 4 tiles. Follow `docs/ticket-standards.md` and the verified, live-tested facts
in `docs/media-tiles/INTEGRATION-NOTES.md`. Do NOT re-discover the integrations — they are
documented and confirmed working.

DONE = every item below is true and shown in the transcript:

## 1. Scope — 4 tiles as real React components (Scenes PARKED)
Built under `apps/web/src/components/media/`, reusing existing `components/ui/` primitives (NOT
copied from the HTML prototypes), placed on the 1366×1000 board via the tile registry:
- **TV Now Playing** (4×3) + modals **Transport & Scrub**, **TV Remote** (D-pad)
- **Sound System** (4×3) + modals **Mixer**, **Per-room Source** + a **useMixer** hook implementing the gang-lock algorithm from the handoff
- **TV Apps** (4×2) + modal **All Apps**
- **Quick-Play** (4×2) + modals **Favorites**, **Spotify**

**Scenes is PARKED — do NOT build it.**

## 2. Real integrations — no fake data, services THROW
A new tRPC **media router** in `apps/api` reads/writes REAL devices:
- **Apple TV + HomePod + 5 Sonos rooms** via the existing Home Assistant client (`media_player` +
  `remote` entities — see INTEGRATION-NOTES.md), plus a **raw Sonos SOAP helper on :1400** for
  grouping / line-in / TV-audio / favorites.
- **Spotify — fully set up and real** (Spotify **has** credentials in 1Password Homelab):
  now-playing + transport via the HA Spotify Connect entity (`media_player.evee_media_player`),
  and the **Quick-Play / Spotify modal** sources real playlists/recently-played — via HA
  `browse_media` and/or the **Spotify Web API** using the existing 1Password creds. The Spotify
  modal must show real Spotify content, not stubs.

ZERO fake data: `bash scripts/check-fake-data.sh` passes, and
`grep -rIE "FALLBACK|PLACEHOLDER" apps/web/src apps/api/src` finds nothing in the new code. Every
tile renders live entity state; no hardcoded sample values ship. Unconfigured services THROW (a
tile shows a `<Skeleton>`, never an invented value).

## 3. Gates green (run each; surface the output)
- `bun run typecheck` exits 0
- `bun run test` passes with **0 failed and 0 skipped**
- `bunx biome check .` clean
- `bun run knip` exits 0 with **zero** findings
No test was deleted, `.skip`'d, `xfail`'d, or weakened, and no guard/gate was disabled or newly
ignored (knip exceptions ONLY via a justified `/** @public */` tag) to get there.

## 4. Storybook
Every new tile AND every new modal has a co-located `*.stories.tsx` with autodocs **plus**
co-located tests; `bash scripts/check-storybook-docs.sh` passes over the new stories.

## 5. Shipped to PROD
Work committed as `type(media/www-xxx)` per the commit guard, **merged to `main` with NO PR**,
pushed; `git status` shows up-to-date with `origin/main` and a **clean tree**. The CI
`test` + `deploy` jobs went green and **bosun rolled the web + api + worker images to prod**
(deploy webhook succeeded / new digests live).

## 6. Verified live in a browser (prod)
Using agent-browser against the LIVE site **https://dashboard.worldwidewebb.co at 1366×1024**
(NOT local dev/storybook):
- Screenshot the board showing **all 4 new tiles rendering REAL data** (not skeletons).
- Screenshot **each of the 7 modals** opened and rendering correctly.
- For each of the 4 tiles and 7 modals (11 total), **state in the transcript what the screenshot
  shows** (the real values seen), so all 11 are confirmed actually rendered live.

## 7. No regressions — existing dashboard still healthy
The 9 existing tiles (Clock, Weather, Network, Tesla, Next 12 Hours, Controls, Dog Cam,
Climate, Upcoming) **still render correctly** on the live prod board, with **no new console
errors** (capture the browser console — it is clean of new errors). Confirm in the transcript
that the prior tiles look unbroken in the prod screenshot, and that `main` is clean and all gates
above are green (nothing else broke to land this).

## Boundaries (forbidden shortcuts)
- Don't build Scenes.
- Don't ship any fake / placeholder / mock / hardcoded device state.
- Don't weaken, skip, or delete tests; don't disable or newly-ignore any guard/gate.
- Don't claim prod-verified from a local screenshot — it must be the live prod URL, and every
  tile and every modal needs its own real screenshot before this is done.
- Don't open a PR — merge worktrees to `main` locally.
