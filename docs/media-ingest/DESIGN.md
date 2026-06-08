# Media ingest pipeline — design & verified facts

**Epic:** CC-kp4k. **Status:** scoped, grounded in real numbers. Foundation for a later media-archive tile + Sonos playback (CC-c2pc).

## Goal in one line

Save things to a YouTube playlist (or paste links in chat) → a media-worker on homelab notices what's missing → downloads best-quality audio always (+thumbnail, +AV1 video per policy) → stores on the Mac Mini → records it in Postgres → cleans/categorizes the title via OpenRouter. Later: browse + play on Sonos.

## Verified numbers (real, not estimated)

Measured from the provided link `g1vH9C_o-vo` — **"Solomun Live at EDC Las Vegas 2026", 1h30m37s, Insomniac** (the exact EDC/Solomun use case):

| Stream | Per 90-min set | ×100 sets |
|---|---|---|
| Best audio (m4a 129k / opus 131k) | ~85 MB | ~8.5 GB |
| 720p video — **AV1 (av01)** | ~652 MB | ~65 GB |
| 720p video — h264 (avc1) | ~1.15 GB | ~115 GB |
| 1080p video — AV1 | ~1.2–1.5 GB | ~120–150 GB |

**Audio is effectively free; video is the entire cost driver.**

## Recorded decisions

1. **Store AV1 video, NEVER re-transcode.** YouTube already serves AV1 (`av01.*`) — the most efficient codec. Its 720p stream (652 MB) is *already* smaller than h264 (1.15 GB) and VP9 (684 MB). Re-encoding AV1→h265 burns hours of Mac Mini CPU per set and *loses* quality for ~zero size win. The compression is done for us; we just pick the AV1 stream. (Rejected alternative: re-transcode to h265 on box.)
2. **Audio is always downloaded at best quality** (m4a/opus, ~85 MB/set). Video is opt-in per source (`video_policy`), default resolution 720p AV1. Keeps the disk bill an order of magnitude lower while keeping audio for everything.
3. **Separate `control-center-media-worker` image**, not folded into the 1s `worker` app. A 90-min download/process must not share a container with the `light-enforcer` (1s reconcile). Different resource profile, different deploy cadence, isolated blast radius. (Harder — new CI job + image — but the right long-term structure. Per engineering-values: take the harder path that unlocks future freedom.)
4. **DB-authoritative job queue.** `media_item.status` (`pending|downloading|done|failed`) IS the queue. The downloader single-flights one `pending` item per cycle. Idempotency: unique `yt_video_id` + skip-if-file-on-disk (the "is it already here?" check).
5. **Thumbnail captured at download time** (`yt-dlp --write-thumbnail`, cheap), stored now so the future tile can show "oh cool, this is the thumbnail" without a backfill.

## Architecture

- **`apps/media-worker`** (new app + image). Reuses `createWorkerRuntime()` (await-before-reschedule, per-worker error isolation, stats). Imports media domain from `@repo/api` via a new `./media` barrel, mirroring the existing `worker-deps.ts` seam (interim until `packages/core`).
- **Workers:**
  - `playlist-poller` (~10m): `yt-dlp --flat-playlist` each enabled `media_source`; upsert any unseen `yt_video_id` as `pending`. Cheap, metadata only.
  - `media-downloader` (tight, single-flight): one `pending` → best audio + thumbnail (+AV1 video per policy) → files on volume → record paths/sizes/duration → `done`; on error `failed`+retry. Disk-space guard before each.
- **Enrichment:** OpenRouter call after download → `{clean_title, artist, event, category}` written back. THROWS if key missing (no fake data).
- **Intake:** tRPC `media.addUrls` mutation = the paste-links-in-chat path (dedupes; the same link 6× collapses to one).
- **Storage:** homelab bind mount `<media dir>:/app/media` (same pattern as `web`'s maps mount in `deploy.config.ts`). DB holds metadata + paths; files on disk.
- **Secrets:** `OPENROUTER_API_KEY` via `fromOp("Homelab", …)` → docker secret file → `env.ts` hydrate (existing pattern). `scripts/save-openrouter.sh` ships it.

## Data model (drizzle, `apps/api/src/db/schema.ts`)

- **`media_source`**: `id`, `kind` (`playlist|adhoc`), `external_id`/`url`, `title`, `enabled`, `video_policy` (`none|on`), `created_at`.
- **`media_item`**: `id`, `source_id` (fk), `yt_video_id` (UNIQUE), `raw_title`, `clean_title`, `artist`, `event`, `category`, `status`, `audio_path`, `video_path`, `thumb_path`, `audio_bytes`, `video_bytes`, `duration_sec`, `error`, `retries`, `created_at`, `updated_at`.

## Human-in-the-loop prerequisites (CC-kp4k.6, .7)

These cannot be done by the build workflow and **must precede the prod push** (an unresolved secret/volume ref breaks bosun's whole-stack deploy):

1. **OpenRouter key** → `scripts/save-openrouter.sh` → 1Password Homelab. (Interactive `op`; only Calum.)
2. **Homelab media volume dir** at the spike-decided path, with enough free disk (spike measures it).

## Out of scope (deferred, filed)

Media-archive tile (CC-kp4k.8), retention/cleanup cronJob (CC-kp4k.9), Sonos playback (CC-c2pc).
