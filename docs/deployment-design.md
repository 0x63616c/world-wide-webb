# Control-Center Deployment Design

Status: **CURRENT** (www-j934) · Scope: how control-center is built, deployed, and kept
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
personal account; token from SOPS vault `PULUMI_ACCESS_TOKEN__TOKEN`).

When you push to `main`: **GitHub Actions builds the changed images** (off the Mini), pushes
them to GHCR, then the deploy job **joins the tailnet on an ephemeral `tag:ci` auth key** (so
the runner can reach homelab's kube-apiserver), sets the per-image digests as Pulumi config,
and runs `pulumi up --stack prod`. Only the workloads whose digest changed roll. The ephemeral
node is revoked after the deploy.

Cluster-level machinery, all declared in `infra/` and reconciled by the same `pulumi up`:

- **Namespaces:** product workloads live in product-owned namespaces,
  `control-center`, `captive-portal`, `text-your-ex`, and `amp`. Shared edge runtime lives in
  `platform`, currently the in-cluster `cloudflared` Deployment and tunnel-token Secret. Names
  inside a namespace stay local (`api`, `web`, `frontend`, `app`); Pulumi logical names and other
  global names use full product slugs (`control-center-api`, `text-your-ex-api`). DNS remains the
  exception: flattened hostnames use each product's `dnsCode`, for example `app--cc`.

- **SOPS+age vault secrets**: `loadVault()` in `infra/src/vault.ts` decrypts `secrets/vault.yaml`
  at Pulumi deploy time and creates native k8s `Secret`s per workload; pods mount them at
  `/run/secrets/<NAME>` paths unchanged. No ESO operator; no 1Password API calls at deploy
  time (1Password is cold-backup only, CC-k8t7).
- **cert-manager** with a Cloudflare **DNS-01** ClusterIssuer issues/renews the captive-portal
  TLS cert (the portal is LAN-only, HTTP-01 can't reach it).
- **CloudNativePG (CNPG)** runs Postgres as a single-instance `Cluster` on a local-path PVC on
  the SSD (not NFS).
- **cloudflared** runs **in-cluster** in the `platform` namespace as a Deployment with **2 replicas** (HA, never an HPA) and
  owns the public `*.worldwidewebb.co` routing; tunnel ingress is declared in the Pulumi
  cloudflare provider. Control Center's wall panel is served at the **private** route
  `app--cc.worldwidewebb.co` behind a Cloudflare **Access** kiosk service-token policy (a
  default-deny `*.worldwidewebb.co` floor sits under it). `/trpc` is same-origin behind that
  host, so there is **no external `api.cc` route** (the api is an internal-only service). The
  legacy public host `dashboard.worldwidewebb.co` stays live as temporary compatibility until the
  iOS/wall-panel cutover is verified, then retired per
  `docs/k3s-migration/cc-legacy-route-retirement.md` (www-jtp0.7).

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
│  SOPS+age loadVault() (infra/src/vault.ts)         → native k8s Secrets              │
│  cert-manager + CF DNS-01 ClusterIssuer            → portal TLS Certificate         │
│  cnpg operator → product Clusters in product namespaces (local SSD PVCs)            │
│  platform namespace → cloudflared Deployment ×2 (HA, never autoscale)               │
│  product namespaces → local Deployments: api · web · worker · frontend · app        │
│  product namespaces → owner CronJobs: pg-backup · captive-portal-pg-backup · tye    │
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
  → build-{web,api,worker,media-worker,storybook,drizzle,captive-portal,map-provision,amp}  (arm64 → GHCR :sha + :main)
  → deploy:
       - collect per-image :main digests (buildx imagetools inspect)
       - join the tailnet with an EPHEMERAL Tailscale auth key (tag:ci), reach homelab's apiserver
       - `pulumi login` (Pulumi Cloud; token from SOPS vault via `prod` environment)
       - `pulumi config set --path` the per-image digest map (see the namespace note below)
       - `pulumi up --yes --stack prod`  → only services whose digest changed roll
       - revoke/expire the ephemeral key; leave the tailnet
```

**Digest pinning** is preserved as Pulumi stack config: a changed digest changes the rendered
Deployment image, so only that workload's pods roll, the same property as the old
`docker stack deploy` digest pin, without bosun. Image repos use full product slugs outside DNS,
for example `www-control-center-api`, `www-captive-portal-portal`,
`www-text-your-ex-api`, and `www-amp-app`. Digest keys match the product-component name, for
example `wwwinfra:imageDigests.control-center-api` and
`wwwinfra:imageDigests.text-your-ex-api`. `pulumi up` is
**declarative-convergent** (it reconciles the whole declared stack to the latest committed
digests every green run), so the old `refs/deploy/main` marker, `mark-deployed`, and
`deploy-drift.yml` are gone, the latest run always converges prod to `main`.

Forced full redeploy: `gh workflow run ci.yml --ref main` (rebuilds + redeploys everything).

---

## 4. Scheduling

Cron jobs are **Kubernetes `CronJob`s declared in `infra/src/crons.ts`**, NOT bosun
`cronJob()` and NOT a third-party scheduler. They run on `TZ=America/Los_Angeles` (set as a pod
env), so a `0 3 * * *` schedule fires at 03:00 LA. Today: `portal-data-purge` (nightly DB
cleanup against the compatibility Control Center database), `pg-backup` (Control Center nightly
logical backup to the unchanged compatibility NAS path), `captive-portal-pg-backup` (Captive
Portal nightly logical backup to its product NAS path), `map-extract` (monthly basemap refresh,
www-hn1i, runs the `map-provision` image in force mode; the build date is resolved at runtime
because Protomaps deletes daily builds after ~7 days, so a pinned date rots). The old
`docker-image-prune` cron is gone, kubelet image GC replaces it.

**Basemap self-provisioning (www-hn1i):** the web Deployment carries a `map-provision`
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

**`com.calum.portal-443-forward` root LaunchDaemon (www-j934.20).** Forwards the mini's LAN
en1 `192.168.0.147:443` → the k8s captive-portal LB `192.168.139.2:443`, so
`https://app--cp.worldwidewebb.co` and the legacy
`https://captive-portal.worldwidewebb.co` are reachable on the LAN with the cert-manager cert.
OrbStack `expose_services` republishes the portal LB's `:80` onto en1 but NOT `:443`: OrbStack's
own built-in HTTPS proxy (`network.https: true`, serving `*.orb.local`) already holds the
wildcard host `:443`, so `expose_services` only lands `:443` on a random NodePort. This raw-TCP
passthrough (the portal terminates its own TLS) is the surgical, restart-free fix. It is a
**system** LaunchDaemon, not a user LaunchAgent, because `:443` is privileged. Install/reinstall
on the mini with `products/captive-portal/apps/frontend/deploy/install-portal-443-forward.sh` (runs `sudo`);
artifacts: `scripts/portal-443-forward.sh` + `products/captive-portal/apps/frontend/deploy/com.calum.portal-443-forward.plist`.
`KeepAlive`, so it self-restores after a reboot/OrbStack restart. Doc-managed like the other
host launchd jobs (apiserver-forward, NFS, watchdog); GOAL boundary 5 wants these under a Pulumi
`LaunchdJob` `command.remote` component, which was never built, tracked in www-j934.22.

**ESO removed (CC-k8t7).** The external-secrets operator and 1Password SDK provider have been
removed from the cluster. Secrets now flow from `secrets/vault.yaml` via `loadVault()` at
Pulumi deploy time. The `256Mi` ESO memory limit note is obsolete.

**`cloudflaredReplicas=2`, committed in `infra/Pulumi.prod.yaml`.** The in-cluster cloudflared
runs 2 replicas for tunnel HA. This is a committed stack-config value, not a code default;
keep it at 2 (HA only, never an HPA).

**`wwwinfra:imageDigests` namespace requirement.** The CI deploy job MUST set the per-image
digest map WITH the `wwwinfra:` config namespace prefix, i.e.
`pulumi config set --path wwwinfra:imageDigests.<svc> <digest>`. **If the `wwwinfra:` prefix is
omitted, the value lands in the wrong (default `pulumi`/project) namespace, `infra/` never reads
it, and builds silently never roll** (the deploy "succeeds" but pods stay on the old digest).
The program reads `new Config("wwwinfra").getObject("imageDigests")`; the key must match.
This is the single most important deploy invariant to get right.

**Postgres backup status and restore proof (www-jtp0.2).** The live backup CronJob is
`pg-backup` in namespace `control-center`, derived from the platform `DatabaseBackup` primitive
while preserving the compatibility path `backups/postgres`. Operator commands:

```bash
kubectl --context cc-homelab -n control-center get cronjob pg-backup -o wide
kubectl --context cc-homelab -n control-center create job --from=cronjob/pg-backup pg-backup-manual-$(date +%Y%m%d%H%M%S)
kubectl --context cc-homelab -n control-center wait --for=condition=complete --timeout=180s job/<job-name>
kubectl --context cc-homelab -n control-center logs job/<job-name>
```

Manual backup proof from M2: job `pg-backup-manual-20260613164659` completed `1/1` in 5s and
wrote `/backup/control_center-20260613.sql.gz`; the NAS-backed compatibility path contained
`control_center-20260613.sql.gz` at `4284983` bytes. Dump/restore proof uses the private local
directory `/Users/calum/control-center-pg-snapshots/www-jtp0.2.5-20260613-171514` and the additive
tool:

```bash
scripts/pg-snapshot-restore.sh --dry-run --source production --scratch <scratch-cluster>
scripts/pg-snapshot-restore.sh --source production --scratch <scratch-cluster> --output-dir <private-dir>
scripts/pg-snapshot-restore.sh --compare-counts <source.tsv> <scratch.tsv>
```

Rollback artifacts are the live production database, the nightly NAS backups, and the private
snapshot directory. Human review is required before production dump capture, final snapshots,
non-scratch restores, backup path changes, or destructive cleanup. Scratch restore validation
must delete only scratch resources after evidence is recorded.

**M7 production data cutover (www-jtp0.7.7).** Moving live Control Center data into the product
CNPG cluster follows `docs/k3s-migration/cc-cutover-runbook.md`, which layers M7 safety gates on
top of the row-count tool above: `scripts/cc-cutover-semantic-checks.sql` runs IDENTICALLY on the
source and the restored DB (then diffed) to prove `device_state`/`integration_sync_status`/weather/
`lamp_mode`/media/`job` survived intact (counts alone don't prove semantics);
`scripts/cc-cutover-preflight.sh` is a red-first gate that refuses the cutover until the rehearsal
report (`cc-restore-rehearsal-report.md`), final snapshots, recorded counts, a named rollback
target, and explicit approval are all present; `scripts/cc-post-cutover-smoke.sh` (www-jtp0.7.9)
proves the stack came back healthy; and `scripts/verify-wall-panel.mjs` (www-jtp0.7.10) verifies
the panel at exactly 1366×1024 on `app--cc`. `POSTGRES_HOST` is already `control-center-rw`, so for
prod the cutover is a DATA move, not a code change.

**Captive Portal product database provisioning (www-jtp0.5.5).** The Captive Portal now has its
own CNPG `Cluster` named `captive-portal`, app database `captive_portal`, read-write Service
`captive-portal-rw`, and basic-auth Secret `captive-portal-postgres-auth`. Its product API
manifest explicitly declares only the secrets it can read: `POSTGRES_PASSWORD`, `RESEND_API_KEY`,
`RESEND_FROM`, `UNIFI_API_KEY`, `WIFI_PASSWORD`, and `WIFI_SSID`. The nightly backup CronJob is
`captive-portal-pg-backup`; it runs at `15 1 * * *`, uses the same PG 18 dump image as the CNPG
server, reads the password from `captive-portal-postgres-auth`, and writes dated
`captive_portal-YYYYMMDD.sql.gz` artifacts under
`backups/world-wide-webb/captive-portal/postgres` on the NAS. Control Center remains unchanged:
`pg-backup` still writes `control_center-YYYYMMDD.sql.gz` to `backups/postgres`.

Captive Portal restore validation uses the same additive proof tool as Control Center. Before any
production database apply that captures or restores portal data, stop for human review and record
the approved source, scratch cluster, and output directory. Then run:

```bash
scripts/pg-snapshot-restore.sh --dry-run --source production --scratch <scratch-cluster>
scripts/pg-snapshot-restore.sh --source production --scratch <scratch-cluster> --output-dir <private-dir>
scripts/pg-snapshot-restore.sh --compare-counts <source.tsv> <scratch.tsv>
```

Rollback note: this provisioning step must leave the old Control Center portal tables untouched.
If the Captive Portal database, auth Secret, service discovery, or backup job fails to provision,
scale any new Captive Portal product DB consumers to zero and keep the existing Control Center
portal path serving until the product database is fixed and restore validation passes.

---

## 7. Acceptance criteria

The migration acceptance lives in [`k3s-migration/GOAL.md`](./k3s-migration/GOAL.md) (the goal
contract, phased) and the per-phase AC on the www-j934 child tickets. The legacy
bosun-era checklist (`docs/acceptance-checklist.md`) is retained only as a historical record of
the original Swarm build.
