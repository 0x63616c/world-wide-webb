# ADR-0014: One www process, with storage migration separate

Accepted for WWW-76, part of WWW-74.

The API and the interval workers share their feature code and database. The
web and manage containers only serve static bundles. Keeping four processes
adds deployment coordination without an isolation requirement.

Run one Bun process and one `www` image. It runs migrations before accepting
traffic or starting any generated worker cycle. The shared worker runtime keeps
cycles from overlapping, records health, and drains in-flight work on shutdown.
`WORKER_CYCLES=on` is the default; `off` supports an HTTP-only second instance.
Operators must enable cycles in exactly one instance per database. Turning
cycles off does not make a second instance read-only.

Bun serves both static builds by hostname. HTML is revalidated and hashed
assets are immutable; absent chunks, maps, media, and API paths never fall back
to HTML. Manage retains its frame denial and content sniffing protection.
Alarm bodies are capped at 8 KiB, notifications at 32 KiB, and media at 10 MiB.
The public listener does not expose metrics. `/healthz` reports database and
cycle state; per-cycle failure does not make the whole process unready.

## Sequence and Talos rollout

Use the explicitly permitted two-PR split. This PR keeps Postgres and all of its
migrations and locking semantics. The follow-up ports the schema and transaction
boundaries to SQLite, including notifications' monotonic revision sequence,
`BEGIN IMMEDIATE` alarm claims, in-memory contract tests, a fixture-tested
one-shot copy, and a local SQLite PVC. Keeping the storage work separate makes
alarm concurrency and data preservation independently reviewable.

The existing Talos pipeline builds `www-control-center-www` in addition to the
legacy images. Its `control-center-www` digest pin activates consolidation.
The `api` Deployment runs this image with Recreate strategy so old and new
cycle owners cannot overlap during replacement. The pipeline scales the old
worker to zero and waits for its pods to terminate before applying this change.
The web and manage Deployments remain declared at zero replicas; their existing
Services forward port 80 to `api:4201`. The tunnel origins, Access policies,
Postgres clusters, media mounts, and all other infrastructure remain in place.
There is a short planned interruption during process replacement.

## Rollback

For later monolith releases, restore the previous `control-center-www` image
digest and apply Pulumi. For the first consolidation release, retain the prior
four image pins. Stop the monolith before restoring the worker:

```sh
kubectl -n control-center scale deployment api --replicas=0
kubectl -n control-center wait --for=delete pod -l app=api --timeout=120s
cd infra
pulumi config rm --path wwwinfra:imageDigests.control-center-www --stack home-server
pulumi up --stack home-server
```

Absence of the www pin restores the four original images, replica counts and
Service selectors. Use the normal deployment credentials. Revert the deployment
change before the next automatic deploy, which would otherwise re-add the pin.
If the initial apply fails after stopping the worker, either retry the apply or
perform this rollback; do not simply scale the worker up while www is running.
Postgres data and migration history are unchanged by this PR.

Keep the old API/worker entrypoints, Dockerfiles, nginx configs, build jobs and
workload resources as deliberate rollback code until Phase 5. No hardware move,
infra teardown, backups, Litestream or R2 is introduced.
