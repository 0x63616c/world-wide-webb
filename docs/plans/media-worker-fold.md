# Fold `media-worker` into `worker` — Implementation Plan

> **For agentic workers:** each Slice is one commit-and-push to `main` (continuous
> delivery — a push deploys prod). Slices are ordered so every push is green and
> reversible on its own. No PRs. Verify with `bun run typecheck` + the named tests
> before every push. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the `media-worker` deployable (product folder, image, CI job, infra
workload, digest key, replicas knob, secret set, api `./media` barrel) and move its
two Queue-Job runners — `youtube_ingest` handler and the `playlist-poller` Worker
Cycle — plus the disk-space guard into the always-on `worker`, so a single worker
process drains the whole Queue and runs Media Ingest.

**Architecture:** The Media Ingest *domain* (services, schema, tables) already lives
in `@control-center/api` and is imported by the entrypoint through a barrel. Today
two entrypoints exist: `worker` (imports `@control-center/api/worker`, drains only
the `notify` Queue-Job type) and `media-worker` (imports `@control-center/api/media`,
drains all types, runs the poller, parked at `replicas 0`). This fold subsumes the
`./media` barrel into `./worker`, makes `worker` the sole Queue drainer, ships the
`yt-dlp`/`ffmpeg` runtime deps + NFS media mount into the `worker` image/workload,
then deletes the `media-worker` product everywhere. **No domain code is deleted** —
only the second deployable.

**Tech Stack:** Bun, tRPC, Drizzle, `@www/worker-runtime`, Pulumi + k3s, GitHub
Actions, `yt-dlp` + `ffmpeg` (Alpine), NFS (Synology DS420+ `/volume1/Homelab`).

## Global Constraints

- Continuous deploy: **every Slice is a small green push to `main`**; no PRs; fix
  forward, never sit on unpushed work.
- `media-worker` is parked at `replicas 0` in prod (`wwwinfra:mediaWorkerReplicas: "0"`)
  and there are no enabled `media_source` rows exercised today, so Media Ingest is
  **dormant in prod**. This is what makes the fold low-urgency-risk: worker gaining the
  handlers is a no-op until a source is enabled. Do **not** rely on this for
  correctness — wire it as if it will run.
- The `worker` runs the ~1s Enforcer Cycles (light/climate/sonos, `intervalMs: 1_000`).
  Folding reverses the original split rationale (media-worker/src/index.ts: *"heavy/long
  downloads must not share a container with the 1s light-enforcer loop"*). Size the
  merged worker to protect the enforcers (see Slice 1 + Open Question 1).
- Vocabulary (CONTEXT.md): a **Queue Job** is claimed-once work; a **Worker Cycle** is a
  fixed-interval loop; **Media Ingest** is the download/enrich pipeline (distinct from
  **AV Control**). This plan folds the *deployable*, not the domain.
- Product-aware CI: per-product path filters + guard scripts
  (`scripts/check-control-center-ci-split.ts`, `scripts/check-dockerfile-manifests.ts`)
  hard-assert the `media-worker` image/filter/script exist today; they must be edited in
  the **same push** that removes what they assert (see Slice 3/4 ordering notes). The
  Pulumi digest validators additionally force the infra `IMAGE_REPOSITORIES` removal and
  the CI digest-loop removal into **one** push — see Slice 3.

---

## Ground-truth inventory (verified against the repo)

What `media-worker` is, everywhere it is referenced:

| Concern | Location | Fate |
|---|---|---|
| Entrypoint | `products/control-center/media-worker/src/index.ts` | delete (logic moves to worker/api) |
| Disk guard + test | `media-worker/src/index.ts` `hasSufficientDisk`, `src/disk-guard.test.ts` | move to `@control-center/api` domain (Slice 2) |
| Package | `media-worker/package.json` (`@control-center/media-worker`) | delete workspace |
| Dockerfile | `media-worker/Dockerfile` (adds `ffmpeg python3 py3-pip` + `pip yt-dlp`) | delete; deps move into worker Dockerfile |
| vitest/tsconfig | `media-worker/{vitest.config.ts,tsconfig.json}` | delete |
| api barrel | `products/control-center/api/src/media.ts` + `"./media"` export in `api/package.json` | delete; unique exports fold into `worker-deps.ts` |
| Domain services | `api/src/services/{youtube-ingest,playlist-poller}-service.ts`, `jobs/queue.ts` | **keep** (still imported, now by worker) |
| Domain tables | `mediaItem`, `mediaSource` in `api/src/db/schema.ts` | **keep** |
| CI build job | `.github/workflows/ci.yml` `build-media-worker`, `mediaworker` paths-filter + output, image-check loop, `needs:` on deploy+notify | delete |
| Infra workload | `infra/src/services.ts` `control-center-media-worker` WorkloadSpec + `IMAGE_REPOSITORIES["media-worker"]` | delete |
| Infra secret map | `infra/src/secrets-map.ts` two `media-worker` entries | delete |
| Platform manifest | `packages/platform/src/index.ts` `media-worker` secretUsage + service entry + `ControlCenterServiceName`/`SecretUsageName` union members | delete |
| Replicas knob | `infra/program.ts` `mediaWorkerReplicas`, `infra/Pulumi.prod.yaml` `wwwinfra:mediaWorkerReplicas` | delete |
| Digest key | `control-center-media-worker` (services.ts, ci.yml, image-digests test) | delete |
| Guard scripts | `scripts/check-control-center-ci-split.ts`, `scripts/check-dockerfile-manifests.ts` | edit (remove media-worker asserts) |
| product.json | `products/control-center/product.json` `media-worker` service | delete |
| dev script | `products/control-center/package.json` `dev:media-worker` (Tiltfile does NOT run it) | delete |
| knip | `knip.jsonc` `products/control-center/media-worker` block | delete |
| Dockerfile COPY | `worker/Dockerfile` + `api/Dockerfile` each `COPY .../media-worker/package.json` | delete those lines |
| Infra tests | `render.test.ts`, `image-digests.test.ts`, `ghcr-pull-secrets.test.ts`, `secrets-derivation.test.ts`, `crons.test.ts` (comment) | edit |

**What `worker` GAINS:**
- Handlers/cycles: `registerYoutubeIngestHandler`, `runPlaylistPollerCycle` (via
  `worker-deps.ts`); a second `media-queue` drain claims `{types:["youtube_ingest"]}`
  (disk-guarded) alongside the existing ungated `notify-queue` drain, so worker drains the
  whole Queue while notify stays independent of media disk (it already imports
  `claimAndRun`).
- Runtime deps in image: `ffmpeg`, `python3`, `py3-pip`, `pip install yt-dlp`
  (+`--break-system-packages`). Image grows ~+200 MB (one apk+pip layer). Net registry
  footprint *drops* — two near-identical bundles become one.
- NFS mount: `mountPath: /app/media`, `subPath: media`, `nfs.path: /volume1/Homelab`,
  and `MEDIA_STORAGE_DIR: /app/media` env — identical to what `api` and `media-worker`
  already mount (pattern proven; `api` writes wake-photos there today).
- Secret: `OPENROUTER_API_KEY` (media-worker had it; worker did not — used by
  `enrichTitle`). `APNS_*` + `POSTGRES_PASSWORD` worker already has.
- Memory: `384M` → `1G` (adopt media-worker's profile; protects the enforcers).

**Interaction with the App-construct `runtime` tag (design §Gap 9 / facets.ts
`CycleSpec.runtime: "worker" | "media-worker"`):** the tag existed *only* to keep the
media-worker fold-vs-run decision an infra knob rather than a folder-structure
commitment. **With the fold decided, the tag has exactly one inhabitant and dies the
deletion test** — drop `runtime` from `CycleSpec`/`HandlerSpec`, and `workers.gen.ts`
no longer splits the `Worker[]` by runtime. Record this in the FINAL App-construct
design so a later slice doesn't reintroduce a two-runtime split. (Documentation change,
folded into Slice 5.)

---

## Slice 1 — Give `worker` the capacity + deps to host Media Ingest (no behaviour change)

**Why first:** land image deps, NFS mount, secret, and memory *before* worker actually
runs the pipeline, so Slice 2's wiring can never spawn a missing `yt-dlp` or write
downloads into a vanishing overlay fs. Worker still drains only `notify` after this
slice — zero functional change, just a bigger, mounted, well-fed container.

**Precondition (before pushing):** run the node-headroom check in Open Question 1 — the
384M→1G bump surges a ~1.4G transient pod on a RollingUpdate and the 8 GB node must have
room, or the new pod stays `Pending` and the deploy silently no-ops while CI stays green.

**New coupling this slice introduces (accept + document):** the NFS mount makes the
Synology NAS a hard startup dependency of the worker pod that also hosts the
availability-critical ~1s light/climate/sonos/schedule Enforcer Cycles. A pod with an
unmountable NFS volume stays `ContainerCreating` and never starts, so if the NAS is
unreachable when the worker (re)starts (node reboot, NAS maintenance) the enforcer loops
stop reconciling — a dependency the worker never had. The `api` already mounts this export,
but api is request-serving; this newly couples the reconcile loops to NAS availability.
Accepted for the fold; the rollback trigger is "worker stuck `ContainerCreating` on the NAS
mount" → revert this commit to restore the mount-free worker.

**Files:**
- Modify: `products/control-center/worker/Dockerfile` (add the runtime-stage apk+pip
  block copied from `media-worker/Dockerfile` lines 57–61)
- Modify: `infra/src/services.ts` (worker WorkloadSpec: add `volumes`, `MEDIA_STORAGE_DIR`
  env, bump `resources.memory` `384M`→`1G`)
- Modify: `packages/platform/src/index.ts` (`workerSecrets`: add `OPENROUTER_API_KEY:
  secretCatalog.openRouter.apiKey`)
- Modify: `infra/test/render.test.ts` (worker expected memory `384M`→`1G`; add worker
  NFS-volume assertion mirroring the media-worker one at lines ~252–258)
- Modify: `infra/test/secrets-derivation.test.ts` (golden snapshot: worker secret set
  gains `OPENROUTER_API_KEY`)

- [ ] **Step 1:** Add to `worker/Dockerfile` runtime stage (after `WORKDIR /app`, before
  the `COPY --from=build`):
  ```dockerfile
  # yt-dlp + ffmpeg for Media Ingest (folded in from media-worker): playlist
  # enumeration and AV1/audio download spawn these as child processes.
  RUN apk add --no-cache ffmpeg python3 py3-pip \
   && pip3 install --break-system-packages yt-dlp \
   && yt-dlp --version \
   && ffmpeg -version | head -1
  ```
- [ ] **Step 2:** In `infra/src/services.ts`, on the `control-center-worker` WorkloadSpec:
  set `resources: { memory: "1G" }`, add `MEDIA_STORAGE_DIR: "/app/media"` into its `env`
  (spread with `haEnv`, matching the api workload), and add the `volumes` block copied from
  the media-worker spec (`mountPath: "/app/media"`, `nfs: { server: nasNfsServer, path:
  "/volume1/Homelab" }`, `subPath: "media"`). Thread `nasNfsServer` — already a
  `serviceSpecs` arg.
- [ ] **Step 3:** In `packages/platform/src/index.ts`, add `OPENROUTER_API_KEY:
  secretCatalog.openRouter.apiKey,` to the `workerSecrets` object.
- [ ] **Step 4:** Update `infra/test/render.test.ts` and
  `infra/test/secrets-derivation.test.ts` to the new expected worker memory, volume, and
  secret set. Run: `bun run --filter @www/infra test` (or `bun run test` scoped to infra).
  Expected: PASS.
- [ ] **Step 5:** Verify Dockerfile guard still green: `bun run scripts/check-dockerfile-manifests.ts`
  (worker Dockerfile still COPYs all workspace manifests — unchanged here). Expected: PASS.
- [ ] **Step 6:** `bun run typecheck`. Expected: PASS.
- [ ] **Step 7:** Commit + push.
  ```bash
  git add products/control-center/worker/Dockerfile infra/src/services.ts \
    packages/platform/src/index.ts infra/test/render.test.ts infra/test/secrets-derivation.test.ts
  git commit -m "feat(worker): add media runtime deps, NFS mount, memory headroom (media-worker fold 1/5)"
  ```

**Verification (post-deploy):** the new worker pod reaches **`Ready`, not `Pending`**
(`kubectl get pod -l app=control-center-worker` → Running/Ready — a Pending pod means the
1G request didn't schedule and the slice silently didn't deploy); `kubectl logs` shows
`worker started`; `kubectl exec` → `yt-dlp --version` succeeds and `/app/media` is the NFS
mount. **Rollback:** revert the commit; worker returns to 384M with no mount (safe — it
wasn't using the mount yet).

---

## Slice 2 — Make `worker` the sole Queue drainer + run the poller; move the disk guard into the domain

**Why now:** worker can now host the pipeline. Register the media handler, add the
`playlist-poller` Cycle, and add a **second, type-scoped, disk-guarded** drain for media
jobs alongside the existing ungated `notify` drain, so worker drains every Queue-Job type
while keeping notification delivery independent of media disk. Push `hasSufficientDisk`
**down into the api domain** (thin entrypoint, deep module) so it is unit-tested in `api`,
not stranded in an entrypoint. `media-worker` is still present at `replicas 0` (never
runs), so double-claiming is impossible.

**Do NOT collapse this into one disk-guarded full drain.** media-worker's entrypoint
disk-guards a single `claimAndRun()` over ALL types — but it runs at `replicas 0`, so in
prod today `notify` is drained by the always-on worker with no disk check. Folding that
guarded full-drain shape into worker would newly couple push-notification availability to
NAS free space: once downloads push `/volume1/Homelab` below the 10 GB threshold,
`hasSufficientDisk()` returns false every tick and `notify` jobs (not-charging / wake /
security pushes) would stop being claimed though APNs is fine. Two separate drains avoid
this.

**Files:**
- Create: `products/control-center/api/src/services/media-disk-guard.ts` (move
  `hasSufficientDisk` here — depends only on `env.MEDIA_STORAGE_DIR` + `getLogger`)
- Create: `products/control-center/api/src/services/media-disk-guard.test.ts` (move the
  three cases from `media-worker/src/disk-guard.test.ts`, retargeted to the new import)
- Modify: `products/control-center/api/src/worker-deps.ts` (export
  `registerYoutubeIngestHandler`, `runPlaylistPollerCycle`, `hasSufficientDisk`)
- Modify: `products/control-center/worker/src/index.ts` (register the youtube handler;
  add the `playlist-poller` Cycle; keep the `notify-queue` drain ungated and add a
  **separate** disk-guarded `media-queue` drain — do NOT put `notify` behind the disk
  guard, see Step 5)

**Interfaces:**
- Consumes (from api domain, already existing): `registerYoutubeIngestHandler()`,
  `runPlaylistPollerCycle(): Promise<void>`, `claimAndRun(opts?): Promise<boolean>`,
  `env.MEDIA_STORAGE_DIR`.
- Produces: `hasSufficientDisk(dir?: string, thresholdBytes?: number): boolean` exported
  from `@control-center/api/worker`.

- [ ] **Step 1 (test first):** Create `api/src/services/media-disk-guard.test.ts` with the
  three cases from the existing `disk-guard.test.ts` (below-threshold → `false`,
  above → `true`, missing dir → `true`), importing `hasSufficientDisk` from
  `./media-disk-guard`. Run it: `bun run --filter @control-center/api test media-disk-guard`.
  Expected: FAIL (module not found).
- [ ] **Step 2:** Create `api/src/services/media-disk-guard.ts`: move `hasSufficientDisk`
  and its `DISK_FREE_THRESHOLD_BYTES` (10 GB) verbatim from `media-worker/src/index.ts`,
  swapping `log` for `getLogger()` and reading `env.MEDIA_STORAGE_DIR` as the default dir.
- [ ] **Step 3:** Run the test. Expected: PASS.
- [ ] **Step 4:** In `api/src/worker-deps.ts` add:
  ```ts
  export { hasSufficientDisk } from "./services/media-disk-guard";
  export { runPlaylistPollerCycle } from "./services/playlist-poller-service";
  export { registerYoutubeIngestHandler } from "./services/youtube-ingest-service";
  ```
- [ ] **Step 5:** In `worker/src/index.ts`: import the three new symbols; call
  `registerYoutubeIngestHandler()` next to `registerNotifyHandler()`; add a
  `playlist-poller` Cycle (`intervalMs: 10 * 60_000, runOnStart: true, run:
  runPlaylistPollerCycle`). **Keep `notify` delivery ungated** and disk-guard only the
  media job types. Replace the single `notify-queue` worker with two type-scoped drains:
  ```ts
  {
    // Notification delivery (APNs fan-out). NEVER disk-guarded: a push has
    // nothing to do with media storage. The pre-fold worker drained notify
    // unconditionally and this must stay true, otherwise a full NAS would
    // silently halt security/wake pushes (regression).
    name: "notify-queue",
    intervalMs: 2_000,
    runOnStart: true,
    run: async () => {
      await claimAndRun({ types: ["notify"] });
    },
  },
  {
    // Media Ingest drain. Disk-guarded: a full NAS must not start a new
    // download. Scope the claim to media types so the guard only ever gates
    // media work, never notify.
    name: "media-queue",
    intervalMs: 2_000,
    runOnStart: true,
    run: async () => {
      if (!hasSufficientDisk()) return;
      await claimAndRun({ types: ["youtube_ingest"] });
    },
  }
  ```
  Rewrite the old `notify-queue` comment block: media-worker is gone, so the "media-worker
  parked at 0 replicas" rationale no longer applies; the type filter now exists to keep the
  disk guard off the notify path. (Worker now owns `notify` + media, on two separate drains.)
  **Note:** the only enqueued job types today are `notify` and `youtube_ingest` (grep
  `enqueueJob(` — Open Question 3). If a media type is added later, add it to the
  `media-queue` `types` list, not `notify-queue`.
- [ ] **Step 6:** `bun run --filter @control-center/worker test` and
  `bun run --filter @control-center/api test`. Expected: PASS.
- [ ] **Step 7:** `bun run typecheck`. Expected: PASS.
- [ ] **Step 8:** Commit + push.
  ```bash
  git commit -am "feat(worker): drain full queue + run playlist-poller; move disk guard to api (media-worker fold 2/5)"
  ```

**Verification (post-deploy):** worker log lists `playlist-poller`, `notify-queue`, and
`media-queue` in its `workers:` startup line; a `notify` job still delivers when the media
volume is below the disk threshold (confirms notify is not gated); a manually enabled
`media_source` (staging) enqueues + downloads to the NFS mount. **Rollback:** revert;
worker returns to `notify`-only drain (media-worker still at 0, so the Queue simply stops
being drained for media — the pre-fold state).

---

## Slice 3 — Remove `media-worker` from INFRA **and** CI in one atomic push

**Why these must be one commit (not two):** the Pulumi digest validators clamp the
`control-center-media-worker` key from **both** sides, so neither the infra-only removal
nor the CI-only removal is green on its own — they are mutually dependent and MUST land
together:

- `IMAGE_DIGEST_KEYS` / `REQUIRED_IMAGE_DIGEST_KEYS` are **derived** from
  `IMAGE_REPOSITORIES` (`infra/src/services.ts:74–79`). `serviceSpecs()` calls
  `validateImageDigests(digests)` **unconditionally** (`services.ts:220`) and
  `validateRequiredImageDigests` when pins are required (`:221`), and `pulumi up` runs on
  every `any_app || infra` push.
- **Infra-first (delete `IMAGE_REPOSITORIES["media-worker"]` alone):** the CI deploy job's
  digest loop (`ci.yml:558`) still lists `www-control-center-media-worker:control-center-media-worker`
  and the GHCR `:main` image still exists, so CI still collects the digest and runs
  `pulumi config set --path wwwinfra:imageDigests.control-center-media-worker` before
  `pulumi up`. `validateImageDigests` then throws `imageDigests.control-center-media-worker
  is not a known product-component image key` → **deploy RED**.
- **CI-first (delete the loop entry alone):** CI stops pinning the digest while
  `REQUIRED_IMAGE_DIGEST_KEYS` still lists it → `validateRequiredImageDigests` throws
  `missing: control-center-media-worker` → **deploy RED**.

So the `IMAGE_REPOSITORIES` removal, the digest-key removal, and the `ci.yml` digest-loop
+ build-job removal all go in **one push**. `image-digests.test.ts` (`"control-center-media-worker":
VALID`) independently confirms the key must be known-and-pinned in lockstep. Because
`replicas 0`, the infra side of this push just deletes a 0-replica Deployment + its Secret
— no running pod is disturbed.

**Files (infra + platform + CI + guards, all together):**
- Modify: `infra/src/services.ts` (delete the `control-center-media-worker` WorkloadSpec
  and `IMAGE_REPOSITORIES["media-worker"]`; remove **every** `mediaWorkerReplicas` site —
  the `ServiceSpecOptions` field (`:200`), the `serviceSpecs` destructure (`:212`), the
  `replicas: mediaWorkerReplicas` usage (`:266`, deleted with the WorkloadSpec), the
  `ServicesArgs` field (`:491`), the `deployServices` destructure (`:593`), and the
  `serviceSpecs({ mediaWorkerReplicas, … })` pass-through (`:667`) — plus the Boundary-6
  header comment. Typecheck fails until all six are removed together.)
- Modify: `infra/program.ts` (delete `mediaWorkerReplicas: cfg.getNumber(...)` at `:90` +
  its comment)
- Modify: `infra/Pulumi.prod.yaml` (delete `wwwinfra:mediaWorkerReplicas: "0"`)
- Modify: `infra/src/secrets-map.ts` (delete both `"media-worker"` entries in
  `serviceSecretUsages` + `SERVICE_SECRET_TARGETS`)
- Modify: `packages/platform/src/index.ts` (delete the `"media-worker"` `secretUsage`
  entry, the `media-worker` service entry in the workloads map, and the `"media-worker"`
  members of the `ControlCenterServiceName` + `ControlCenterSecretUsageName` unions)
- Modify: `.github/workflows/ci.yml` (delete the `build-media-worker` job; the
  `mediaworker:` paths-filter block + the `mediaworker` line in `outputs`; the
  `www-control-center-media-worker:control-center-media-worker` entry in **both** the
  image-check loop and the **digest-collection loop** (`:558`); remove `build-media-worker`
  from the two `needs:` arrays — deploy + notify)
- Modify: `scripts/check-control-center-ci-split.ts` (drop `"mediaworker"` from
  `controlCenterFilters`; drop `"dev:media-worker"` from `requiredProductScripts`; drop
  `www-control-center-media-worker` from the image list; drop `control-center-media-worker`
  from the digestKey list)
- Modify: `products/control-center/package.json` (delete the `dev:media-worker` script)
- Modify: `infra/test/render.test.ts`, `infra/test/image-digests.test.ts`,
  `infra/test/ghcr-pull-secrets.test.ts`, `infra/test/secrets-derivation.test.ts` (drop
  all `media-worker`/`mediaWorkerReplicas`/`control-center-media-worker` expectations)
- Modify: `packages/platform/test/control-center-manifest.test.ts` if it enumerates the
  service set (verify + update)

- [ ] **Step 1:** Delete the infra + platform source references listed above. Grep to
  confirm none remain in `infra/src` / `packages/platform/src`:
  `grep -rn "media-worker\|mediaWorker" infra/src packages/platform/src`. Expected: no hits.
- [ ] **Step 2:** Delete the CI build job, both `ci.yml` loop entries (image-check **and**
  digest-collection), the paths-filter, and the `needs:` references; drop the guard-script
  asserts + the `dev:media-worker` product script.
- [ ] **Step 3:** Update the infra + platform tests to drop the media-worker expectations.
- [ ] **Step 4:** `bun run --filter '@www/infra' test && bun run --filter '@www/platform' test`.
  Expected: PASS.
- [ ] **Step 5:** `bun run scripts/check-control-center-ci-split.ts`. Expected: PASS.
- [ ] **Step 6:** Confirm the workflow no longer references media-worker anywhere:
  `grep -n "media-worker\|mediaworker" .github/workflows/ci.yml`. Expected: no hits.
- [ ] **Step 7:** `bun run typecheck`. Expected: PASS (union members + all six replicas
  sites gone, no dangling refs).
- [ ] **Step 8:** Commit + push.
  ```bash
  git commit -am "chore: remove media-worker infra workload + CI build job + digest pin (media-worker fold 3/5)"
  ```

**Verification:** CI run is green; no `build-media-worker` job; the deploy job's
`pulumi up` no longer collects or pins `control-center-media-worker` and neither validator
throws; `pulumi preview` shows deletion of the `control-center-media-worker` Deployment +
`control-center-secrets-media-worker` Secret and nothing else surprising. **Rollback:**
revert the single commit — the 0-replica workload, digest key, and build job all restore
together (still consistent). The GHCR `:main` image is untouched by this push (last built
by the prior green run), so a revert re-pins the still-present digest cleanly.

---

## Slice 4 — Delete the `media-worker` product folder + api `./media` barrel

**Ordering:** this removes the `@control-center/media-worker` workspace. The Dockerfile
`COPY .../media-worker/package.json` lines in `worker/Dockerfile` + `api/Dockerfile` and
the `FULL_INSTALL_DOCKERFILES` entry in `check-dockerfile-manifests.ts` reference that
workspace; `bun.lock` regenerates without it. All must be one push so the manifest guard
stays green.

**Files:**
- Delete: `products/control-center/media-worker/` (entire folder)
- Delete: `products/control-center/api/src/media.ts`; remove `"./media": "./src/media.ts"`
  from `products/control-center/api/package.json` `exports`
- Modify: `products/control-center/worker/Dockerfile` + `products/control-center/api/Dockerfile`
  (delete the `COPY products/control-center/media-worker/package.json ...` line in each)
- Modify: `scripts/check-dockerfile-manifests.ts` (drop
  `"products/control-center/media-worker/Dockerfile"` from `FULL_INSTALL_DOCKERFILES`)
- Modify: `products/control-center/product.json` (delete the `media-worker` service entry)
- Modify: `knip.jsonc` (delete the `products/control-center/media-worker` block)
- Regenerate: `bun.lock` (via `bun install`)

- [ ] **Step 1:** `rm -rf products/control-center/media-worker`; delete `api/src/media.ts`
  and its `exports` line; remove the two Dockerfile COPY lines; update the four config
  files above.
- [ ] **Step 2:** `bun install` (regenerates `bun.lock` without the workspace). Confirm
  `media-worker` gone: `grep -n "media-worker" bun.lock`. Expected: no hits.
- [ ] **Step 3:** `bun run scripts/check-dockerfile-manifests.ts` (worker/api Dockerfiles
  now COPY exactly the remaining workspace set). Expected: PASS.
- [ ] **Step 4:** `bun run knip`. Expected: no new unused-export/file errors from the
  `./media` removal. (If `youtube-ingest`/`playlist-poller` now flag as unused, that means
  Slice 2's `worker-deps.ts` re-export is missing — fix Slice 2, don't suppress.)
- [ ] **Step 5:** `bun run typecheck && bun run test`. Expected: PASS.
- [ ] **Step 6:** Commit + push.
  ```bash
  git commit -am "chore: delete media-worker product + api ./media barrel (media-worker fold 4/5)"
  ```

**Verification:** full green CI; worker + api images still build (they no longer COPY the
deleted manifest). **Rollback:** revert (single commit restores folder + barrel + lock).

---

## Slice 5 — Docs + App-construct `runtime` tag retirement

**Files:**
- Modify: `products/control-center/Tiltfile` comment (if it mentions the media-worker
  split — verify; the worker block at lines ~85–93 may want a note that ingest now runs
  here)
- Modify: `CODEBASE_OVERVIEW.md`, `CLAUDE.md` "Current Shape" (drop `media-worker` from
  the product list; note ingest folded into `worker`)
- Modify: the tracked App-construct design doc `docs/plans/app-construct.md` (the
  scratchpad copy at `scratchpad/designs/FINAL-app-construct.md` is a `/private/tmp`
  working file, NOT in git — do not put it in a commit): note that with the fold decided,
  a per-job `runtime: "worker" | "media-worker"` tag on `CycleSpec`/`HandlerSpec` would
  have exactly one inhabitant and should NOT be introduced; `workers.gen.ts` composes a
  single `Worker[]` with no per-runtime split; Media Ingest is a headless App whose cycles
  run in the one worker. **This is a design-doc note only** — the App-construct is unbuilt
  (grep confirms zero `CycleSpec`/`defineApp`/`workers.gen` hits in the code today), so
  there is no `runtime` tag to delete from any source file; the note just prevents a future
  slice from reintroducing the two-runtime split.
- Modify: `docs/media-ingest/DESIGN.md` + `GOAL.md` (note the deployable folded into
  `worker`; the pipeline is unchanged)

- [ ] **Step 1:** Make the doc edits (tracked repo docs only — no scratchpad file, no code,
  no tests).
- [ ] **Step 2:** `grep -rn "media-worker" --include='*.md' docs/ CLAUDE.md CODEBASE_OVERVIEW.md`
  — every remaining hit is either historical (archive/, k3s-migration/ runbooks describing
  past state) or corrected. Leave archive/runbook history intact; fix current-state docs.
- [ ] **Step 3:** Commit + push.
  ```bash
  git commit -am "docs: media-worker folded into worker; retire per-job runtime tag (media-worker fold 5/5)"
  ```

**Rollback:** revert (docs only).

---

## Self-review — coverage against the task brief

- **What worker gains** — Slice 1 (deps, NFS mount, memory, OPENROUTER secret) + Slice 2
  (handlers, poller, full-queue drain, disk guard). ✔
- **Image size impact** — Slice 1 note (+~200 MB apk/pip layer; net registry footprint
  drops from two images to one). ✔
- **NFS mount** — Slice 1 (worker had none; gains the same `/app/media` NFS subPath the
  api workload already proves). ✔
- **yt-dlp/ffmpeg deps** — Slice 1 Dockerfile block. ✔
- **What dies** — build-media-worker CI job + mediaworker path filter + infra workload +
  digest key, all in one atomic push (Slice 3), Dockerfile (Slice 4), worker-deps/media
  barrel split (Slice 2 folds, Slice 4 deletes `media.ts`). ✔
- **App-construct `runtime` tag** — resolved: never introduced; design-doc note (Slice 5). ✔
- **Memory/resource sizing** — Slice 1 (`1G` + Open Question 1 on reserveCpus + node
  headroom). ✔
- **Deployable slices / verification / rollback** — each slice above. ✔

---

## Open Questions

1. **Worker sizing + blast radius.** Folding puts a 90-min AV1 `ffmpeg` mux in the same
   container as the ~1s light/climate/sonos Enforcer Cycles — the exact thing the original
   split avoided. Plan sets `memory: 1G`. Confirm: (a) is 1G enough, or match some headroom
   above media-worker's old 1G? (b) add `reserveCpus` / a CPU limit so a runaway mux can't
   starve the enforcers (laggy lights)? **The node-headroom check is a Slice-1
   PRECONDITION, not a before-ingest gate** — see the Slice-1 note below. The memory bump
   ships in Slice 1, so if the 8 GB node lacks the transient headroom the new pod stays
   `Pending` and the deploy silently never takes effect while CI stays green.

   **Slice-1 precondition (do before pushing Slice 1):** `kubectl describe node <worker
   node>` and confirm allocatable memory has room for the worker request going 384M→1G
   *plus* the RollingUpdate surge (replicas=1, no strategy override → k8s default
   maxSurge 1 / maxUnavailable 0, so a new 1G pod is scheduled alongside the old 384M pod
   before the old terminates — ~1.4G transient). media-worker was at 0 replicas so it freed
   nothing schedulable; this is net +~616M of actually-scheduled memory. **Slice-1
   post-deploy verification must assert the new worker pod reached `Ready`, not `Pending`**
   (`kubectl get pod -l app=control-center-worker` → Running/Ready), otherwise the mount +
   deps silently never land and Slice 2's media image stacks behind the same unschedulable
   request.
2. **Disk-guard placement.** Plan pushes `hasSufficientDisk` into
   `api/src/services/media-disk-guard.ts` (thin entrypoint, testable in api). Acceptable,
   or keep it in `worker/src`? (Domain placement is the deeper-module choice.)
3. **Full-queue drain confirmation.** Slice 2 keeps a `notify` drain and adds a
   `{types:["youtube_ingest"]}` media drain so worker claims every Queue-Job type across
   two type-scoped workers. Correct now that it's the sole drainer — confirm no
   other job type exists that must stay unclaimed.
4. **Local dev.** The Tiltfile runs `worker` but never ran `media-worker`; after Slice 2,
   dev `worker` will run `playlist-poller`, which spawns `yt-dlp` (absent locally). It
   no-ops with zero enabled `media_source`s and per-source errors are caught+logged — but
   confirm we accept the noisy log, or gate the poller behind an env flag in dev.
5. **`mediaWorkerReplicas` / Pulumi.prod.yaml key removal.** Confirm no external
   tooling/runbook (`docs/k3s-migration/*`, on-box scripts) reads
   `wwwinfra:mediaWorkerReplicas` before deleting the config key.
6. **`OPENROUTER_API_KEY` in the worker secret — RESOLVED, not a risk.**
   `secretCatalog.openRouter.apiKey` maps to the vault key `OPENROUTER__CREDENTIAL`
   (`packages/platform/src/index.ts`), the **same** catalog entry media-worker already
   resolves — it is not a new secret and needs no vault change. `infra/src/secrets-map.ts`
   derives `SERVICE_SECRETS` from the platform manifest automatically, so adding
   `OPENROUTER_API_KEY` to `workerSecrets` needs no `secrets-map.ts` edit — only the golden
   snapshot in `infra/test/secrets-derivation.test.ts`, which Slice 1 Step 4 already covers.

---

## Review log

Adversarial review findings and their disposition (verified against the repo):

- **[FATAL] Slice 3 (infra digest removal) and Slice 4 (CI digest-loop removal) are not
  green independently — the two Pulumi validators clamp `control-center-media-worker` from
  both sides.** ACCEPTED + FIXED. Verified: `validateImageDigests` is called
  unconditionally (`services.ts:220`) and `IMAGE_DIGEST_KEYS`/`REQUIRED_IMAGE_DIGEST_KEYS`
  derive from `IMAGE_REPOSITORIES`; the CI digest loop (`ci.yml:558`) still collects+pins
  the key until edited. Merged the old Slices 3 and 4 into a single atomic Slice 3 (infra +
  CI + guards in one push); renumbered subsequent slices (5→4, 6→5) and commit tags to N/5.
- **[MAJOR] Slice 2 puts APNs `notify` delivery behind the media disk guard — a full NAS
  would silently halt all push notifications (regression).** ACCEPTED + FIXED. Verified:
  today `worker/src/index.ts:145` drains `notify` ungated; media-worker's disk-guarded
  full drain runs at replicas 0. `claimAndRun` supports `{types}`; only `notify` +
  `youtube_ingest` are enqueued. Rewrote Slice 2 to keep an ungated `notify-queue` drain
  and add a **separate** disk-guarded `media-queue` (`{types:["youtube_ingest"]}`).
- **[MAJOR] Node-headroom check for the 384M→1G bump is deferred to "before enabling
  ingest" but the bump ships in Slice 1 — risks a Pending pod / silent no-op deploy while
  CI is green.** ACCEPTED + FIXED. Made the `kubectl describe node` check a Slice-1
  precondition, documented the RollingUpdate surge (~1.4G transient, no strategy override),
  and made Slice 1 verification assert the new pod reaches `Ready`, not `Pending`.
- **[MAJOR] (complexity, duplicate of the deploy-safety notify finding)** ACCEPTED + FIXED
  by the same two-drain rewrite in Slice 2.

Minors: `mediaWorkerReplicas` edit surface (all six `services.ts` sites now listed) —
fixed; OQ6 `OPENROUTER_API_KEY` reframed as not-a-risk (same vault key, no vault change) —
fixed; new NFS→enforcer coupling documented as an accepted risk with a rollback trigger in
Slice 1 — fixed; Slice 5 doc edit retargeted from the untracked scratchpad file to tracked
`docs/plans/app-construct.md` and the `runtime`-tag retirement reframed as a design-doc
note (no such tag exists in code — grep-confirmed) — fixed. Disk-guard placement
(`api/src` vs `worker/src`) — REJECTED (judgment call, already Open Question 2; the api
placement keeps the entrypoint thin and the guard unit-tested in the domain, a defensible
choice not a defect).
