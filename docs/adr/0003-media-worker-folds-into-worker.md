# media-worker folds into the single worker deployable

There is **one** worker deployable. The `media-worker` product — its image, CI build job, infra
workload, digest key, `wwwinfra:mediaWorkerReplicas` knob, secret set, and the `@control-center/api/media`
barrel — is deleted, and its two Queue-Job runners (`youtube_ingest` handler, `playlist-poller`
Worker Cycle) plus the disk-space guard move into the always-on `worker`. The `worker` image gains
`ffmpeg`/`yt-dlp` and the `MEDIA_STORAGE_DIR` NFS mount so Media Ingest actually runs once folded
in. This is a **user-locked decision.**

**It supersedes the committed infra comments describing a Phase-4 / Boundary-6 media-worker
bring-up** (`infra/program.ts:59-62`, `infra/src/services.ts:7,180`, `Pulumi.prod.yaml:
mediaWorkerReplicas: "0"`). Those comments are no longer authoritative; the fold plan removes them.

## Why it is a real trade-off

The original split was deliberate and documented: `media-worker/src/index.ts` states "heavy/long
downloads (90+ min sets) must not share a container with the 1s light-enforcer loop. Isolated blast
radius." Folding **reverses that rationale** — a 90-minute `ffmpeg` mux now shares a container with
the ~1s light/climate/sonos Enforcer Cycles, and the NFS mount newly couples those availability-
critical reconcile loops to NAS availability. The fold is accepted anyway (one deployable instead
of two; media-worker was parked at 0 replicas and dormant), with mitigations: a memory bump
(384M→1G), a CPU-starvation guard, and keeping `notify` delivery on a separate, ungated Queue drain
so a full NAS cannot silently halt push notifications.

## Consequence for the App construct

The App-construct design's `CycleSpec.runtime: "worker" | "media-worker"` tag now has exactly one
inhabitant and must **not** be introduced as a dispatch mechanism; `workers.gen.ts` composes a
single `Worker[]` with no per-runtime split.

## Why it is recorded

Hard to reverse — the teardown deletes a deployable, its image, infra state, and CI plumbing across
a coupled multi-slice push. Surprising without context — a reader will find the Phase-4 bring-up
comments and the explicit "must not share a container" split rationale and wonder why they were
abandoned. A real trade-off — one deployable vs. the enforcer-isolation the split was built to
provide.
