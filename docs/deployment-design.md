# Control-Center Deployment Design

Status: **CURRENT** (CC-j934) · Scope: how control-center is built, deployed, and kept
alive on `homelab` (the Mac Mini).

> **History.** This repo previously deployed through `bosun`, an in-repo tool that rendered
> `deploy.config.ts` to a Docker Swarm stack on OrbStack, with a `bosun-agent` webhook that CI
> POSTed a digest map to. That whole layer (`packages/bosun`, `deploy.config.ts`, the
> `bosun-agent`, the `refs/deploy/main` marker, `deploy-drift.yml`) has been removed. Deploy is
> now **Pulumi + Kubernetes**. The deep design lives in
> [`k3s-migration/DESIGN.md`](./k3s-migration/DESIGN.md); this file is the operator-facing
> overview plus the hard-won recovery knobs.

---

## 1. Plain English (read this first)

`infra/` is a **Pulumi TypeScript** program that declares the whole cluster, and a service is
still declared in one typed place (a `ComponentResource` vocabulary succeeds bosun's
`service()` / `cronJob()` builders). `pulumi up --stack prod` reconciles the OrbStack built-in
**Kubernetes** cluster on `homelab` to match it. State lives in **Pulumi Cloud** (Calum's
personal account; token `op://Homelab/Pulumi/access-token`).

When you push to `main`: **GitHub Actions builds the changed images** (off the Mini), pushes
them to GHCR, then the deploy job **joins the tailnet on an ephemeral `tag:ci` auth key** (so
the runner can reach homelab's kube-apiserver), sets the per-image digests as Pulumi config,
and runs `pulumi up --stack prod`. Only the workloads whose digest changed roll. The ephemeral
node is revoked after the deploy.

Cluster-level machinery, all declared in `infra/` and reconciled by the same `pulumi up`:

- **External Secrets Operator (ESO)** with the **1Password SDK provider** syncs each declared
  1P field into a native k8s `Secret`; pods mount them at the existing `/run/secrets/<NAME>`
  paths, so app images need zero changes. The cluster reads 1Password once per refresh interval
  (pods read etcd), which structurally fixes the old bosun per-deploy `op` rate-limit churn.
- **cert-manager** with a Cloudflare **DNS-01** ClusterIssuer issues/renews the captive-portal
  TLS cert (the portal is LAN-only, HTTP-01 can't reach it).
- **CloudNativePG (CNPG)** runs Postgres as a single-instance `Cluster` on a local-path PVC on
  the SSD (not NFS).
- **cloudflared** runs **in-cluster** as a Deployment with **2 replicas** (HA, never an HPA) and
  owns the public `*.worldwidewebb.co` routing; tunnel ingress is declared in the Pulumi
  cloudflare provider.

Three things stay on the host by hand (manual runtime): Tailscale, the Home Assistant VM, and
OrbStack.

---

## 2. Architecture overview

```
┌─ HOST INFRA (manual runtime; plists managed by Pulumi command.remote) ──────────────┐
│  Tailscale daemon · HA QEMU VM @ :8123 + socat proxy · unifi socat :8444            │
│  homelab-drive NFS mount · orbstack-watchdog · k8s-apiserver-forward socat          │
├─ RUNTIME (one dep, start-at-login) ─────────────────────────────────────────────────┤
│  OrbStack → built-in single-node Kubernetes (kubelet image GC)                      │
│   └ "Expose services to local network devices" ON (LAN reach for the portal)        │
├─ CLUSTER (declared in infra/, applied by `pulumi up --stack prod`) ─────────────────┤
│  external-secrets (ESO) + 1Password SDK provider  → native k8s Secrets              │
│  cert-manager + CF DNS-01 ClusterIssuer            → portal TLS Certificate         │
│  cnpg operator → Cluster "control-center" (local-path PVC on SSD)                   │
│  cloudflared Deployment ×2 (HA, never autoscale)                                    │
│  Deployments: api · worker · web · storybook · captive-portal · drizzle · media-w.  │
│  CronJobs (infra/src/crons.ts): portal-data-purge · pg-backup · map-extract         │
├─ EXTERNAL STATE (Pulumi providers, Pulumi Cloud backend) ───────────────────────────┤
│  cloudflare: Access apps/policies + tunnel ingress   · unifi: adopt-only import     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Full per-service / per-cron mapping, secrets, data-migration runbook, the pod→host egress
solution, captive-portal LAN exposure, and the UniFi import plan are all in
[`k3s-migration/DESIGN.md`](./k3s-migration/DESIGN.md).

---

## 3. Deploy path (push → live)

```
push to main
  → changes  (dorny/paths-filter; per-app filters + an `infra/**` filter)
  → test     (typecheck · biome · knip · guards · vitest coverage · badges), gates deploy
  → build-{web,api,worker,media-worker,storybook,drizzle,captive-portal}  (arm64 → GHCR :sha + :main)
  → deploy:
       - collect per-image :main digests (buildx imagetools inspect)
       - join the tailnet with an EPHEMERAL Tailscale auth key (tag:ci), reach homelab's apiserver
       - `pulumi login` (Pulumi Cloud, op://Homelab/Pulumi/access-token)
       - `pulumi config set --path` the per-image digest map (see the namespace note below)
       - `pulumi up --yes --stack prod`  → only services whose digest changed roll
       - revoke/expire the ephemeral key; leave the tailnet
```

**Digest pinning** is preserved as Pulumi stack config: a changed digest changes the rendered
Deployment image, so only that workload's pods roll, the same property as the old
`docker stack deploy` digest pin, without bosun. `pulumi up` is **declarative-convergent** (it
reconciles the whole declared stack to the latest committed digests every green run), so the
old `refs/deploy/main` marker, `mark-deployed`, and `deploy-drift.yml` are gone, the latest run
always converges prod to `main`.

Forced full redeploy: `gh workflow run ci.yml --ref main` (rebuilds + redeploys everything).

---

## 4. Scheduling

Cron jobs are **Kubernetes `CronJob`s declared in `infra/src/crons.ts`**, NOT bosun
`cronJob()` and NOT a third-party scheduler. They run on `TZ=America/Los_Angeles` (set as a pod
env), so a `0 3 * * *` schedule fires at 03:00 LA. Today: `portal-data-purge` (nightly DB
cleanup), `pg-backup` (nightly logical backup to the NAS), `map-extract` (monthly basemap
refresh, CC-hn1i, runs the `map-provision` image in force mode; the build date is resolved at
runtime because Protomaps deletes daily builds after ~7 days, so a pinned date rots). The old
`docker-image-prune` cron is gone, kubelet image GC replaces it.

**Basemap self-provisioning (CC-hn1i):** the web Deployment carries a `map-provision`
initContainer (same image, if-missing mode) so a fresh stack extracts `socal.pmtiles` into the
`maps` PVC before nginx ever serves, no manual provisioning step exists. Ad-hoc refresh:
`kubectl create job --from=cronjob/map-extract <name> -n control-center`. nginx serves
`/maps/` with a real 404 on a missing file (no SPA fallback), so a provisioning failure is
loud. Hermetic tests: `scripts/test-map-provision.sh` (also a CI `test`-job gate).

---

## 5. Persistence & restart survival

```
login → OrbStack starts at login → built-in Kubernetes restarts → pods Running (etcd state)
       → local-path PVCs intact (CNPG pgdata, drizzle-data, maps) → in-cluster cloudflared
         reconnects the tunnel → live
```

OrbStack autostart is **login-scoped** (auto-login + start-at-login), the same persistence
anchor as the Swarm era, NOT a boot daemon. The reboot acceptance test is: restart OrbStack (or
reboot the mini) and confirm the node comes back on login with `kubectl get pods -A` all
Running unattended and `https://dashboard.worldwidewebb.co` returning 200. The host launchd
runtimes below keep running throughout.

---

## 6. Recovery: hard-won operational knobs

These are the load-bearing host/cluster settings discovered during the migration. A future
session bringing the box back up, or debugging an OOM-loop / unreachable apiserver, needs them.

**OrbStack VM memory: `memory_mib=6144`.** Set via `orbctl config set k8s.memory_mib=6144` (or
the equivalent VM-memory knob). **5120 was too small**, the k8s control plane OOM-loops and the
cluster never settles. 6144 is the proven floor on the 8GB mini.

**Home Assistant VM: `-m 2G` in `~/homeassistant-os/start-haos.sh`.** The HAOS QEMU VM needs 2G.
That start script ALSO needs `export PATH=/opt/homebrew/bin` near the top, so launchd can exec
`qemu` on reboot (launchd's minimal PATH doesn't include Homebrew, so without it the VM silently
fails to start after a reboot).

**`com.calum.k8s-apiserver-forward` launchd socat job.** Forwards `127.0.0.1:26443` →
the OrbStack VM node IP `192.168.139.2:26443`. OrbStack does **not** always rebind the host
loopback to the apiserver after a restart, so without this job `kubectl` (and `pulumi up`)
against the loopback context can fail post-reboot. The job is `KeepAlive` so it self-restores.

**`com.calum.portal-443-forward` root LaunchDaemon (CC-j934.20).** Forwards the mini's LAN
en1 `192.168.0.147:443` → the k8s captive-portal LB `192.168.139.2:443`, so
`https://captive-portal.worldwidewebb.co` is reachable on the LAN with the cert-manager cert.
OrbStack `expose_services` republishes the portal LB's `:80` onto en1 but NOT `:443`: OrbStack's
own built-in HTTPS proxy (`network.https: true`, serving `*.orb.local`) already holds the
wildcard host `:443`, so `expose_services` only lands `:443` on a random NodePort. This raw-TCP
passthrough (the portal terminates its own TLS) is the surgical, restart-free fix. It is a
**system** LaunchDaemon, not a user LaunchAgent, because `:443` is privileged. Install/reinstall
on the mini with `apps/captive-portal/deploy/install-portal-443-forward.sh` (runs `sudo`);
artifacts: `scripts/portal-443-forward.sh` + `apps/captive-portal/deploy/com.calum.portal-443-forward.plist`.
`KeepAlive`, so it self-restores after a reboot/OrbStack restart. Doc-managed like the other
host launchd jobs (apiserver-forward, NFS, watchdog); GOAL boundary 5 wants these under a Pulumi
`LaunchdJob` `command.remote` component, which was never built, tracked in CC-j934.22.

**ESO controller memory limit: `256Mi`.** The external-secrets controller's limit must be
**256Mi**, not 192Mi, it gets **OOMKilled on a cold-start reconcile** at 192Mi (syncing every
ExternalSecret at once on startup spikes memory).

**`cloudflaredReplicas=2`, committed in `infra/Pulumi.prod.yaml`.** The in-cluster cloudflared
runs 2 replicas for tunnel HA. This is a committed stack-config value, not a code default;
keep it at 2 (HA only, never an HPA).

**`ccinfra:imageDigests` namespace requirement.** The CI deploy job MUST set the per-image
digest map WITH the `ccinfra:` config namespace prefix, i.e.
`pulumi config set --path ccinfra:imageDigests.<svc> <digest>`. **If the `ccinfra:` prefix is
omitted, the value lands in the wrong (default `pulumi`/project) namespace, `infra/` never reads
it, and builds silently never roll** (the deploy "succeeds" but pods stay on the old digest).
This is the single most important deploy invariant to get right.

---

## 7. Acceptance criteria

The migration acceptance lives in [`k3s-migration/GOAL.md`](./k3s-migration/GOAL.md) (the goal
contract, phased) and the per-phase AC on the CC-j934 child tickets. The legacy
bosun-era checklist (`docs/acceptance-checklist.md`) is retained only as a historical record of
the original Swarm build.
