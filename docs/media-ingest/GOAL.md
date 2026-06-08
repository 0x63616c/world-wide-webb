# GOAL — ship the media-ingest pipeline (www-kp4k) to prod

Invoke with `/goal @docs/media-ingest/GOAL.md`. Design + verified facts: `docs/media-ingest/DESIGN.md`. This file IS the success condition.

## End state (all must be transcript-provable)

The epic **www-kp4k** media-ingest pipeline is built, gated, merged to `main` (NO PR), pushed, deployed by bosun, and verified processing a real YouTube link on homelab — **without fake data and without weakening any gate.**

### Executor

Build the autonomous chain (milestones M1–M5 = `www-kp4k.1`–`.5`) with the **`ship` workflow**, parallelized per its design:

```
Workflow({ name: "ship", args: { resume: "www-kp4k", push: false } })
```

Run with `push:false` first so the whole stack is built + gated in worktrees with **zero prod impact**. Flip to the prod push (below) only AFTER the human prerequisites are satisfied — pushing M2 triggers bosun's whole-stack deploy, and an unresolved secret/volume ref would break prod.

### Build scope (each an assertion in the epic `--design` contract A1–A8)

- **A1** `playlist-poller` upserts every unseen playlist video as `media_item` status=pending; idempotent on UNIQUE `yt_video_id` (re-poll → zero dupes).
- **A2** `media-downloader` downloads **best-quality audio for every item (always)** + thumbnail to the homelab media volume; row records `audio_path`, `thumb_path`, byte sizes, `duration_sec`.
- **A3** Video downloaded per source `video_policy` using the **AV1 (`av01`) stream, default 720p; NEVER re-transcoded.**
- **A4** Titles cleaned + categorized (`artist`/`event`/`category`) via OpenRouter, written back. Service **THROWS** if `OPENROUTER_API_KEY` unconfigured — no fake/placeholder enrichment.
- **A5** tRPC `media.addUrls` accepts pasted YouTube URLs (deduped) → pending items (the chat-spam path).
- **A6** Disk-space guard refuses a download when free space < threshold.
- **A7** Runs as its **own `control-center-media-worker` image/service**, built in CI (`build-media-worker` job + path filter) and deployed by bosun with the media volume mounted + secrets from 1Password.
- **A8** No fake data; gates green; conventional commits; merged to `main` no PR.

### Gates (run each, show output, none weakened)

- `bun run typecheck` — clean across all workspaces.
- `bun run test` — 0 failed, **0 skipped**, no test deleted/weakened to pass.
- `bunx biome check .` — clean.
- `bunx knip` — **zero findings** (use `/** @public */` for deliberate API, never silent ignores).
- `scripts/check-fake-data.sh` — clean; a repo grep for `FALLBACK`/`PLACEHOLDER` (uppercase) returns empty.
- Every commit subject is `type(media/www-kp4k.N): …` (commit-msg guard passes).

### Human prerequisites — gate the prod push (www-kp4k.6, .7)

These are NOT done by the workflow and **must be true before the final push**:

- [ ] `OPENROUTER_API_KEY` saved to 1Password Homelab via `scripts/save-openrouter.sh`.
- [ ] Homelab media volume dir exists at the spike-decided path with sufficient free disk (spike www-kp4k.6 records the number + the default `video_policy`/resolution/retention decision).
- [ ] `deploy.config.ts` volume path + secret ref match the provisioned reality.

### Ship to prod (after prerequisites)

- [ ] Final `git push` to `main`; `git status` shows clean, up to date with origin.
- [ ] CI green (typecheck + test:coverage + knip + storybook-docs); `build-media-worker` produces `ghcr.io/0x63616c/control-center-media-worker`.
- [ ] bosun deploy rolls **only** the new `media-worker` (digest-pinned); the rest of the stack is undisturbed (no whole-stack regression).
- [ ] `media-worker` boots healthy in prod; logs show the runtime started and both workers registered.

### Verified live in prod (describe each in the transcript — the evaluator can't see homelab)

- [ ] Paste the provided link (`https://youtu.be/g1vH9C_o-vo`) via `media.addUrls` (or add it to a watched playlist). State the created `media_item` id + status.
- [ ] The downloader processes it end-to-end: state the on-disk file paths + byte sizes (expect audio ~85 MB; if video enabled, ~650 MB 720p AV1) + `duration_sec` (~5437s), and that the files exist on the homelab volume.
- [ ] OpenRouter enrichment wrote back a cleaned title + `artist=Solomun`, `event=EDC Las Vegas 2026` (or close) — state the actual row values.
- [ ] No regressions: the rest of the dashboard still renders; no new errors in the `media-worker` logs.

### Done

- [ ] M1–M5 (`www-kp4k.1`–`.5`) closed; spike `.6` + provisioning `.7` resolved; `.8`/`.9` parked deferred.
- [ ] Epic `www-kp4k` acceptance met.

## Boundaries / forbidden shortcuts

- Do **not** re-transcode AV1 (recorded decision — it's already optimal).
- Do **not** fold media work into the 1s `worker` app (separate image is the point).
- Do **not** invent enrichment data or stub the OpenRouter call — it throws when unconfigured.
- Do **not** weaken/skip/delete tests, loosen knip, or add `thresholds` to coverage to get green.
- Do **not** push to prod before the human prerequisites are satisfied (would break the whole-stack deploy).
- No PR, ever — worktrees merge to `main` locally.
