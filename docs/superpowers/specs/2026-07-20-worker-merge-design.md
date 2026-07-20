# Worker merge + YouTube archival — design

**Date:** 2026-07-20
**Status:** approved, ready for implementation plan

## Problem

`products/control-center/media-worker` is a separate deployable that has **never run a
job in prod**. It is pinned at 0 replicas (`wwwinfra:mediaWorkerReplicas`), originally as
a Boundary-6 migration checkpoint ("prove it Running + NFS-mounted, then park"), and left
parked afterwards on the belief that YouTube downloads carry a high memory cost.

That belief is wrong. yt-dlp streams to disk through a **1 KB buffer** (`--buffer-size`
default is 1024 bytes); memory is flat with respect to file size. ffmpeg muxing is a
sequential stream copy, also constant memory. There was never a memory problem to solve
at 85 MB or at 8 GB.

Meanwhile the split imposes real cost: two images, two deployables, two Dockerfiles, a
duplicated runtime seam, and a `notify` handler registered in both processes with a
type-filter workaround in `worker` to stop it stealing media jobs.

Separately, the ingest feature is unfinished: there is no UI, `media.addUrls` has zero
callers, and no `media_source` rows exist.

## Goal

One `worker` deployable that runs both the interval reconcilers and the durable job
queue, with YouTube archival actually running against a real playlist.

**Purpose of the archive:** long-term storage of DJ sets, playable later in VLC off the
NAS. Not a streaming feature — the filesystem is the interface.

## Decisions

| Decision | Rationale |
|---|---|
| One deployable, `media-worker` deleted | No memory reason for the split; process-level coupling is the only cost |
| Job types are plain `Worker`s | Per-type concurrency 1 falls out of await-before-reschedule; no dispatcher needed |
| Video only, no separate audio file | Muxed file already contains audio; one yt-dlp call instead of two |
| `videoPolicy` deleted | Always want video; a half-download mode nobody set is dead config |
| LLM title enrichment deleted | Four columns nothing reads, a paid call per ingest, and a throw path that fails jobs whose download already succeeded |
| No global concurrency budget | A shared budget lets types starve each other; per-type isolation is structural |
| Unhandled job types park | A type with no `jobWorker` is never polled, so it waits instead of burning retries |
| One `maxMs` per type, driving both the timeout and the reaper lease | A timeout catches a hung handler; only a reaper catches a dead process. Sharing one declared number avoids two constants drifting apart |
| memory `512M` | Homelab is constrained; downloads don't consume RAM |
| Disk floor `50 GB` | Guard runs before the download and can't know its size, so the floor must exceed one file with margin |
| No `LISTEN/NOTIFY` | Polling is adequate at this scale; explicitly out of scope |

## Architecture

### One construct, not two

The existing `Worker` contract (`packages/worker-runtime/src/types.ts`) is a named
interval loop with one async cycle. The runtime already guarantees:

- a cycle never overlaps itself (await-before-reschedule)
- a failing cycle never kills its own loop or a sibling's (per-cycle try/catch)
- independent `setTimeout` chains per worker

Those are exactly the semantics a per-job-type queue consumer needs. So a job type is
**a worker whose cycle drains that type** — no dispatcher, no lane, no concurrency knob:

```ts
jobWorker("youtube_ingest", runYoutubeIngest, { maxMs: 60 * 60_000 })
// sugar for { name, intervalMs: 2000, run: () => claimOne(type, handler, maxMs) }
```

What this buys, all from machinery that already exists:

- **Per-type concurrency 1** — the runtime won't reschedule until the cycle finishes
- **Type isolation** — separate timer chains; a 20-minute download cannot delay `notify`
- **Unhandled types park** — nothing polls them, so nothing claims them
- **Per-type telemetry** — existing stats and `worker cycle exceeded interval` warnings

Queue-specific concerns (payload, `attempts`, backoff, terminal states) live inside
`claimOne` — a data-access concern, not a scheduling one. That separation is what
removes the need for a second construct.

### Explicit registration

`registerHandler()` mutates a module-global `Map` and must be called before
`runtime.start()` or jobs silently never run. That ordering constraint is invisible and
load-bearing. Handlers become plain exported functions, passed at the entrypoint
alongside workers, so the entire behaviour of the process is one literal:

```ts
const runtime = createWorkerRuntime([
  lightEnforcer, climateEnforcer, sonosVolumeEnforcer, deviceSync,
  partyMode, scheduleRunner, weatherIngest, githubActionsPoll, ascVersionPoll,
  jobWorker("notify", runNotifyJob, { maxMs: 60_000 }),
  jobWorker("youtube_ingest", runYoutubeIngest, { maxMs: 60 * 60_000 }),
  staleJobReaper,
], { logger: log })
```

### Per-type time limits

Each job type declares one `maxMs`, which drives **both** enforcement points below.
A single declared number, not a timeout knob plus a separate reaper lease.

| type | `maxMs` | reasoning |
|---|---|---|
| `notify` | 1 min | an APNs call is sub-second; a minute means something is badly wrong, without false-positiving on a slow network |
| `youtube_ingest` | 1 hour | sets should download in minutes; this is a ceiling for pathological cases, not a target |

### Crash recovery

A timeout and a reaper catch **different** failures, so both are needed:

- **In-process timeout** — the handler hangs while the process is alive (yt-dlp stuck on
  a dead connection, socket never closed). The timeout aborts at `maxMs`, marks the job
  failed, and normal backoff retries it.
- **Reaper** — the *process itself* dies (OOM kill, pod eviction, SIGKILL mid-deploy).
  No timeout can fire, because nothing is alive to fire it. This is the more likely
  failure on a constrained box.

Without the reaper, a crash mid-download leaves two orphans:

1. **Job stuck at `status='running'`** — the claim query only selects `status='queued'`,
   so the row is invisible to every future claim. `attempts` was already incremented.
   It stalls silently, forever. `schema.ts:43` anticipated this ("if we add a watchdog
   later"); the watchdog was never added and `locked_by` is never even populated.
2. **`.part` files on the NAS** — a crash 6 GB into an 8 GB file leaves 6 GB behind,
   never resumed because the job never re-runs.

The reaper sweeps rows whose lease has expired, deriving the lease from the same
per-type `maxMs` rather than a separately-tuned constant. A grace margin on top absorbs
clock skew and the gap between the handler's own timeout firing and the row being
updated, so the reaper never races a job that is about to fail itself:

```sql
UPDATE job SET status = 'queued', updated_at = now()
WHERE status = 'running'
  AND locked_at < now() - (max_ms_for(type) + grace)
```

Since `maxMs` lives in the worker declarations rather than the database, the reaper
worker is constructed with the same `{ type: maxMs }` map used to build the job workers
— one source of truth, no constant to keep in sync.

This resolves both orphans: yt-dlp resumes from `.part` by default when re-run against
the same output path, so the partial becomes a resume point rather than waste.

The lease must exceed the longest legitimate run of that type, or the reaper could
requeue a job that is still running and produce two yt-dlp processes on one file.

## Changes

### 1. Job-as-worker plumbing

- Add `claimOne(type, handler, maxMs)` in `products/control-center/api/src/jobs/queue.ts`
  — claim one row of one type (`FOR UPDATE SKIP LOCKED`), run under a `maxMs` timeout,
  ack/nack with existing backoff. Derived from `claimAndRun`.
- Add `jobWorker(type, handler, { maxMs })` returning a plain `Worker`, 2s interval.
- The timeout must abort the **subprocess**, not just abandon the promise.
  `execFileAsync` accepts an `AbortSignal`; without wiring it, a timed-out ingest leaves
  an orphaned yt-dlp still writing to the NAS while the retry starts a second one on the
  same file — worse than the hang it was meant to fix.
- Add the stale-job reaper, constructed from the same `{ type: maxMs }` map.
- Delete the module-global handler registry, `registerHandler`, and
  `_clearHandlersForTest`. `registerNotifyHandler` / `registerYoutubeIngestHandler`
  become plain exported handler functions.
- Delete `claimAndRun`'s "no handler registered → permanently fail" branch — unreachable
  once each worker polls only its own type, and it is the burn-the-retries behaviour we
  explicitly do not want.

### 2. Runtime cleanups (retired by the merge)

- Delete `WorkerRuntime.stats()` — zero consumers outside the package and its own tests.
  Internal `WorkerStats` bookkeeping stays (failure streaks, debug snapshot).
- Delete the `statsEveryNRuns` option — it exists only because worker used 60 and
  media-worker 30. One process, one constant.
- Drop `WorkerStats.memory` — it samples process-wide `process.memoryUsage()` and stores
  it per worker, so post-merge it is the same number duplicated 12×, sampled every cycle
  to be logged every 60th.

### 3. Merge the apps

- `worker/src/index.ts` absorbs the playlist-poller loop, the disk guard, and both job
  workers. `notify-queue` becomes `jobWorker("notify", …)`.
- Delete `products/control-center/media-worker` entirely.
- `worker/Dockerfile` gains the runtime-stage block:
  `apk add --no-cache ffmpeg python3 py3-pip && pip3 install --break-system-packages yt-dlp`.
- Disk guard threshold 10 GB → **50 GB**.

### 4. Video-only ingest

In `products/control-center/api/src/services/youtube-ingest-service.ts`:

- Delete the `-f bestaudio -x` call entirely. One yt-dlp invocation.
- Delete `videoPolicy`: the column, the payload field, the branch, and both hardcoded
  `"on"` sites in `trpc/routers/media.ts` (:225, :248).
- Add `-N 4` (`--concurrent-fragments`) — YouTube serves DASH and we currently fetch one
  fragment at a time; this is the real throughput win.
- Output template `${videoId}.%(ext)s` →
  `%(uploader)s/%(upload_date)s - %(title)s [%(id)s].%(ext)s`. The DB keeps the video ID
  as identity; the filename serves the human browsing the NAS in VLC.
- Keep `--write-thumbnail`. Keep the AV1 selector and the never-re-encode rule. Duration
  now read from the video file.

### 4b. Remove LLM title enrichment

Every ingest currently calls OpenRouter (`gpt-4o-mini`) to parse the raw YouTube title
into `clean_title` / `artist` / `event` / `category` (`youtube-ingest-service.ts:259-290`).
Nothing reads those columns — no UI, no query, and the archive filename comes from
yt-dlp's own `%(uploader)s` / `%(title)s`, not from these fields.

Worse, `enrichTitle` throws when the key is present but the call fails, so a flaky
OpenRouter fails an ingest whose multi-GB download already succeeded, and burns its
retries. For an archival job that is backwards: the artifact is on disk, and metadata
nobody reads is failing the record.

- Delete `enrichTitle` and its call site.
- Drop `OPENROUTER_API_KEY` from `api/src/env.ts` (:48, :127) and from the worker's
  secret usage in `packages/platform/src/index.ts:460`.
- Leave the `packages/logger` redaction entries — they cost nothing and protect against
  the key reappearing.

### 5. Schema migration

Drop `media_source.video_policy`, `media_item.audio_path`, `media_item.audio_bytes`,
and the enrichment columns `media_item.clean_title`, `artist`, `event`, `category`.
Also drop columns the audit found unread, which the merge is the natural moment to clear:

| column | why |
|---|---|
| `media_item.retries` | retry counting lives in `job.attempts`; only a schema test referenced it |
| `media_item.error` | only ever written as `null`, never read; failures land in `job.last_error` |
| `job.result` | zero reads and zero writes — declared "useful for debugging", never wired |
| `job.locked_by` | never written; the reaper keys off `locked_at`, and `replicas: 1` means no instance to identify |
| `media_source.kind` (+ `media_source_kind_idx`) | never read; what actually distinguishes a source is whether `external_id` or `url` is set |

`media_source.title` stays — nothing reads it, but it is the human label an operator sees
in `psql`, which is the only management interface these rows have.

**Row counts are not zero.** `media_source` has 1 row, `media_item` 93, `job` 137 (44
`notify` done, 93 `youtube_ingest` queued since 2026-06-08). Every column being dropped
is NULL across all 93 `media_item` rows, so the drop is still data-safe — but it is not
the empty-table drop an earlier version of this spec claimed.

Additionally, retune `job_claim_idx` from `(status, run_after, priority)` to
`(status, type, run_after, priority)`. Every claim now filters on a single `type`, and
the reaper filters `type` + `locked_at`; the existing index no longer matches the access
pattern. Irrelevant at 137 rows, but free while a migration is already being written.

`media_item.raw_title` stays — it is the identity/label written at insert time by the
poller, independent of enrichment.

Run `bunx biome format --write` on the generated migration meta before committing.

### 6. Infra

- Delete the `media-worker` workload and `mediaWorkerReplicas` from `infra/src/services.ts`.
- Remove `media-worker` from `infra/src/secrets-map.ts` and `packages/platform/src/index.ts`.
- `worker`: memory `384M` → **`512M`**, add the NFS volume (`/app/media` ←
  `/volume1/Homelab`, subPath `media`) and `MEDIA_STORAGE_DIR=/app/media`.
- Drop the media-worker image from the CI build matrix.

### 6b. The existing backlog

93 `youtube_ingest` jobs have sat at `queued` since 2026-06-08, never claimed because
media-worker is parked. That is this design's parking behaviour already demonstrated in
prod for six weeks, not a theory.

They stay. Deleting them changes nothing: dedup is global (`media_item_yt_video_id_idx`
is unique on `yt_video_id` alone, not per source), and all 93 IDs are in the playlist —
verified, `overlap=93, db_only=0, playlist_only=4`. So deleting merely re-parents them to
`src_djsets` on the next poll and loses the June provenance.

Expect the first deploy to archive **97 sets** (the 93 plus 4 the playlist has gained).
Sampled from the real playlist: 58 min – 2h12m each, 709 MB – 1.68 GB, averaging ~1.3 GB
— roughly **126 GB total** against 5.9 TB free on the NAS. The 50 GB floor is never
approached.

Their payloads still carry `videoPolicy: "on"`, which the handler ignores after §4. Harmless.

### 7. Seed and verify

Seed the playlist source:

```sql
INSERT INTO media_source (id, kind, external_id, title, enabled)
VALUES ('src_djsets', 'playlist', 'PL59a6ZZ2kJGrjLI7cb6hxXr4EfmBnzseW', 'DJ Sets', true);
```

Verify: poller enumerates IDs, `media_item` rows appear, first ingest lands on the NAS
under a readable `uploader/date - title [id].ext` path, job row reaches `done`.

### 8. Docs

- `CLAUDE.md` Current Shape — remove the media-worker line; worker is loops + jobs.
- Stale parked-media-worker comments at `packages/platform/src/index.ts:448-461`.
- `infra/src/services.ts:7-9` Boundary-6 comment.

## Risks

- **Process-level coupling.** A container OOM now takes down the reconcilers with the
  downloader. Cycle-level failures were already isolated by the runtime, so this is the
  only new blast radius, and it is accepted for one deployable instead of two.
- **512M is a judgement call.** Downloads don't consume RAM, but if the Bun process plus
  a yt-dlp subprocess proves tight under a real ingest, raise it — this is one number in
  `services.ts`.
- **First real run.** Nothing has exercised this path in prod. Expect the first ingest to
  surface issues the tests can't (yt-dlp on Alpine, NFS write permissions, filename
  characters the NAS rejects).

## Out of scope

- `LISTEN/NOTIFY` to replace polling.
- Per-type concurrency overrides — add when a type has evidence it needs to burst.
- Enriched metadata driving archive paths (`Boiler Room/2019 - Nina Kraviz.mkv` rather
  than YouTube's uploader/title). Needs a post-download rename step, which has to be
  crash-safe; speculative polish on an archive that doesn't exist yet.
- Any ingest UI. The filesystem is the interface.
- Managing `media_source` rows through anything but `psql`. There is no tRPC procedure or
  UI for creating a playlist source, so the watched-playlist list lives only in prod's
  database rather than in the repo. Making sources declarative (seeded from config) is a
  reasonable follow-up once more than one playlist exists.
- Chunked/segmented downloads (`--download-sections`) — solves a memory problem that
  doesn't exist, and stitching requires `--force-keyframes-at-cuts`, which re-encodes.
