# DESIGN, CC-j934: control-center on Pulumi + OrbStack Kubernetes

The implementation design for migrating control-center off bosun + Docker Swarm onto
Pulumi-managed OrbStack Kubernetes. Inputs and constraints: [`GOAL.md`](./GOAL.md) (the
goal contract) and [`RECON.md`](./RECON.md) (grounded facts + Calum's approved decisions).
This doc executes those decisions; it does not re-litigate them. It replaces
[`deployment-design.md`](../deployment-design.md) at Phase 6.

Both Phase-0 gating spikes **PASSED** (verified 2026-06-11), so the platform choice holds:
§5a (captive-portal LAN exposure via OrbStack `expose_services`) and §5b (media-worker NFS
from a pod). The one design-critical outcome is that the Synology DS420+ is **NFSv3-only**, so
every NFS mount in this migration MUST be a `PersistentVolume` with
`mountOptions: [nfsvers=3, nolock, tcp]` (§5b); that constraint is carried into the mapping
table, the backup section, and every NFS-touching child ticket's AC.

---

## 1. Architecture overview

```
┌─ HOST INFRA (manual runtime; plists managed by Pulumi command.remote) ──────────────┐
│  Tailscale daemon · HA QEMU VM @ :8123 + socat proxy · unifi socat :8444            │
│  homelab-drive NFS mount (192.168.0.218:/volume1/Homelab) · orbstack-watchdog       │
│  zero + zero.sampler (separate project, untouched)                                  │
├─ RUNTIME (one dep, start-at-login) ─────────────────────────────────────────────────┤
│  OrbStack 2.1.1 → built-in single-node Kubernetes (kubelet image GC)                │
│   └ "Expose services to local network devices" ON (LAN reach for the portal)        │
├─ CLUSTER (declared in infra/, applied by `pulumi up`) ──────────────────────────────┤
│  external-secrets (ESO) + 1Password SDK provider  → native k8s Secrets              │
│  cert-manager + CF DNS-01 ClusterIssuer            → portal TLS Certificate         │
│  cnpg operator → Cluster "control-center" (local-path PVC on SSD)                   │
│  cloudflared Deployment ×2 (HA, never autoscale)                                    │
│  Deployments: api · worker · web · storybook · captive-portal · drizzle             │
│  Deployment (scaled per spike): media-worker                                        │
│  CronJobs: portal-data-purge · portal-cert-renew(→cert-manager) · map-extract       │
├─ EXTERNAL STATE (Pulumi providers, Pulumi Cloud backend) ───────────────────────────┤
│  cloudflare: Access apps/policies/tags + tunnel ingress (re-homed from bosun)       │
│  unifi (filipowm, bridged): ADOPT-ONLY import of existing net/wlan/dns/user/syslog  │
│   + NEW www-guest VLAN/SSID/guest-access  · walled-garden + netflow stay direct-API │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Platform.** OrbStack built-in Kubernetes on `homelab` (Apple M2, 8GB). kubectl client
v1.33.9 present. 8GB ⇒ never run full Swarm + full k3s at once (boundary 6); cutover is
stop-Swarm → start-k3s with a brief overlap only for the tunnel switch (§7).

**IaC.** Pulumi TypeScript in this monorepo under `infra/`. A `ComponentResource`
vocabulary succeeds bosun's `service()` / `cronJob()` builders, so a service is still
declared in one typed place. State lives in **Pulumi Cloud** under Calum's personal account
`calumpeterwebb-icloud-com` (the op token authenticates as personal; RECON item 3's
`the-workflow-engine` username is stale, `pulumi whoami` returns the personal account), token
`op://Homelab/Pulumi/access-token`, never printed; reversible later via
`pulumi stack export/import`. Designed so a future Hetzner/cloud cluster is a
cheap stack swap (RECON decision 13): components take cluster/provider as inputs, no host
path is hardcoded into a component's contract.

**Secrets.** External Secrets Operator with the **1Password SDK provider** (a
service-account token, NO Connect server). ESO syncs each declared 1P field into a native
k8s `Secret`; pods mount them at the existing `/run/secrets/<NAME>` paths, so app images
need **zero changes**. The cluster reads 1Password once per refresh interval (pods read
etcd), which structurally fixes the bosun op rate-limit churn (RECON decision 4,
[[bosun-agent-op-rate-limit]]).

**Postgres.** CloudNativePG (CNPG) operator managing a single-instance `Cluster` on a
**local-path PVC on the mini's SSD** (NOT NFS: corruption footgun + the DS420+ is 2GB RAM).
New nightly logical backups to the NAS (today no backups exist, `autobackup:false`).

**TLS.** cert-manager with a CF **DNS-01** `ClusterIssuer` (the portal is LAN-only, HTTP-01
can't reach it). The CF API token needs `Zone.DNS:Edit` **+ `Zone.Zone:Read`**. This
replaces the bosun `portal-cert-renew` acme.sh cron.

**Ingress.** `cloudflared` runs **in-cluster** as a Deployment, **2 replicas** (HA only,
never an HPA). It owns the public `*.worldwidewebb.co` routing; tunnel ingress is declared
in the Pulumi cloudflare provider (re-homed from `packages/bosun/src/reconcile/routes.ts`).

**Deploy.** GitHub Actions push model: build changed images → digests → `pulumi up` over an
**ephemeral Tailscale auth key** (so the runner joins the tailnet only for the deploy and
the node is revoked after). `refs/deploy/main` marker, `mark-deployed`, `deploy-drift.yml`
all retire. Digest pinning + path filters are preserved (§6).

---

## 2. Per-service / per-cron mapping

All 10 services + 4 crons from [`deploy.config.ts`](../../deploy.config.ts). Memory caps
are the CC-ke9a hard caps already inlined per service in `deploy.config.ts` (carried over
verbatim as k8s `limits.memory`); `requests.memory` is set conservatively below the cap so
the 8GB node schedules everything. The two services with a CC-ke9a cpu reservation
(`reserveCpus`) get a matching `requests.cpu`. Secrets are ESO-synced and mounted at
`/run/secrets/<NAME>`; images are GHCR `ghcr.io/0x63616c/control-center-*` pulled with an
`imagePullSecret`.

### Services

| Service | k8s resource | replicas | limits.mem (CC-ke9a) | requests | secrets (ESO → /run/secrets) | image | notes |
|---|---|---|---|---|---|---|---|
| **api** | Deployment + ClusterIP Service `:4201` | 1 | 512M | 256M mem, 0.5 cpu | HA_TOKEN, UNIFI_API_KEY, WIFI_SSID/PASSWORD, POSTGRES_PASSWORD, HOME_LAT/LON/PLACE_NAME/RADIUS_MILES, SPOTIFY_*, RESEND_API_KEY/FROM | control-center-api | request-only; readiness `GET /up`, liveness `/up`; `/health/climate` as a startup-time check. HA via headless Service+Endpoints to host LAN IP `:8123` (NOT host.docker.internal). UniFi via `https://192.168.0.1`. |
| **worker** | Deployment | 1 | 384M | 192M mem | HA_TOKEN, UNIFI_API_KEY, WIFI_SSID/PASSWORD, POSTGRES_PASSWORD, HOME_*, SPOTIFY_* | control-center-worker | no Service (no traffic); the reconcile/ingest loops. Secrets mirror api (deploy-config test asserts lockstep). |
| **media-worker** | Deployment | **1** (spike passed, §5b) | 1G | 256M mem | POSTGRES_PASSWORD, OPENROUTER_API_KEY | control-center-media-worker | NFS PV for the Synology media share (replaces the host bind mount), **`mountOptions: [nfsvers=3, nolock, tcp]`** (DS420+ is NFSv3-only - §5b). Un-parks CC-6mz7. |
| **web** | Deployment + ClusterIP `:80` | 1 | 96M | 48M mem | none | control-center-web | route `dashboard.worldwidewebb.co`; reverse-proxies `/api`→`api:4201`. Basemap `/maps/*.pmtiles` from a `maps` PV populated by `map-extract` (§ below). |
| **storybook** | Deployment + ClusterIP `:6006` | 1 | 96M | 48M mem | none | control-center-storybook | route `storybook.worldwidewebb.co`; CF Access email-OTP gate (`CF_ACCESS_ALLOWED_EMAIL`). |
| **captive-portal** | Deployment + **LoadBalancer** `:443/:80` (spike passed, §5a) | 1 | 64M | 32M mem | none | control-center-captive-portal | LAN-only, NEVER tunneled. Cert from cert-manager into a mounted volume; nginx proxies only `/api/trpc/portal.*`. LAN reach via a LoadBalancer Service republished on en1 (192.168.0.147) by OrbStack `expose_services`, replacing the `portal-lan` proxy + `:42069` hack. |
| **drizzle** | Deployment + ClusterIP `:4983` | 1 | 256M | 128M mem | MASTERPASS, POSTGRES_PASSWORD | control-center-drizzle | route `drizzle.worldwidewebb.co`; CF Access email-OTP gate. Persists in a `drizzle-data` PVC. |
| **postgres** | CNPG `Cluster` (1 instance) + Service | 1 | 768M | 384M mem, 0.5 cpu | superuser/app creds via CNPG Secret (POSTGRES_PASSWORD bridged) | CNPG-managed PG image | local-path PVC on SSD. Replaces the `postgres()` builder + named `pgdata` volume. CNPG owns the Service the app connects to. |
| **cloudflared** | Deployment | **2** (HA) | 128M | 64M mem, 0.25 cpu | TUNNEL_TOKEN | cloudflare/cloudflared:2025.10.1 | `--token-file /run/secrets/TUNNEL_TOKEN`. Public ingress; outbound-only. |
| **bosun-agent** | **DELETED** | - | - | - | - | - | The CI deploy webhook receiver is removed; GH Actions runs `pulumi up` directly (§6). 1P "Bosun Webhook Token" + GH secret deleted (§9). |

CF identifiers/Access client-ids that today ride bosun-agent's secret block (CF_ACCOUNT_ID,
CF_ZONE_ID, CF_TUNNEL_ID, CF_ACCESS_*_CLIENT_ID, CF_ACCESS_ALLOWED_EMAIL) move to Pulumi
config / the cloudflare provider, since Pulumi (not an in-cluster agent) now reconciles
Access + routes. Email/PII stays in 1P (resolved as a Pulumi secret config from `op`),
never a literal in the public repo (no-personal-email guard).

### Crons

| Cron | k8s resource | schedule (TZ=America/Los_Angeles) | mapping |
|---|---|---|---|
| **docker-image-prune** | **DELETED** | - | kubelet image GC replaces it (high 85% / low 80%, eval 5m). External prune tools break kubelet's accounting (RECON decision 7); no image-prune CronJob exists in k3s. |
| **portal-data-purge** | `CronJob` | `0 2 * * *` | runs the api image, `command: bun purge.js`; needs POSTGRES_PASSWORD only. `concurrencyPolicy: Forbid`, `restartPolicy: Never`, history limits 3/1. |
| **portal-cert-renew** | **cert-manager** `Certificate` + DNS-01 `ClusterIssuer` | continuous (renewBefore window) | acme.sh cron retired; cert-manager issues/renews `captive-portal.worldwidewebb.co` and writes the secret cert-manager-side. The portal mounts that secret (§5a). |
| **map-extract** | `CronJob` (manual-trigger; rare cron `0 5 1 1 *`) | yearly placeholder | go-pmtiles `extract` into the `maps` PV. Driven manually via `kubectl create job --from=cronjob/map-extract`. `suspend: true` is acceptable since it's manual-only; keep the cron as the declarative record of the recipe. |

`TZ=America/Los_Angeles` is set as a pod env on every workload that has it today (api,
worker, media-worker, portal-data-purge), preserving the weather-ingest LA-local parsing.

### Set-once cluster infra (not in deploy.config.ts today, added by this migration)

| Resource | k8s | purpose |
|---|---|---|
| external-secrets operator + 1P `ClusterSecretStore` | Deployment(s) + CRDs | secret sync, root token `op://Homelab/Service Account Auth Token: Homelab` |
| cert-manager + CF DNS-01 `ClusterIssuer` | Deployment(s) + CRDs | portal TLS |
| cnpg operator | Deployment + CRDs | Postgres |
| **pg-backup** | `CronJob` (NEW) | nightly CNPG/pg_dump → NAS via an NFS PV with `mountOptions: [nfsvers=3, nolock, tcp]` (§ below) |
| local-path provisioner | (OrbStack built-in) | SSD-backed PVCs for CNPG + drizzle-data + maps |

**Nightly NAS backup (new, RECON decision 5 / GOAL Phase 3).** A `CronJob` (e.g. `0 1 * * *`
LA) runs `pg_dump` (or `cnpg` plugin backup) of the `control_center` DB and writes a
**dated** artifact (`control_center-YYYYMMDD.sql.gz`) onto an NFS `PersistentVolume` pointed
at the NAS backup path. The NFS spike passed (§5b), so this uses a direct NFS PV - which MUST
carry **`mountOptions: [nfsvers=3, nolock, tcp]`** (the DS420+ is NFSv3-only; a v4 default
mount gets "Connection refused"). One manual run must produce a dated file visible via `ls` on
the NAS (Phase 3 acceptance).

---

## 3. Secrets via ESO

- One `ClusterSecretStore` of provider `onepassword-sdk` (or `1password` SDK kind),
  authenticated by the **service-account token** (no Connect). The token is the single
  bootstrap secret, seeded into a k8s Secret `op-service-account` once (out-of-band, from
  `op`), never committed.
- One `ExternalSecret` per service whose `data` maps `/run/secrets/<NAME>` → the 1P
  `op://Homelab/<item>/<field>` ref already declared in `deploy.config.ts`. ESO writes a
  native `Secret`; the Deployment mounts it as files at `/run/secrets`, byte-identical to
  the current docker-secret layout, so `env.ts` reading `/run/secrets/POSTGRES_PASSWORD` is
  unchanged.
- `refreshInterval` modest (e.g. 1h) so a rotated 1P value propagates without a redeploy.
- Acceptance (Phase 3): `kubectl get externalsecret -A` all `SecretSynced/Ready=True`; no
  secret VALUE ever printed.

CNPG owns the Postgres credential lifecycle. The app's `POSTGRES_PASSWORD` must match what
CNPG provisions: bridge by having ESO sync the existing `op://Homelab/Control Center
Postgres/password` into the CNPG `Cluster`'s superuser/app secret (so the migrated data and
the same password line up), rather than letting CNPG mint a random one.

---

## 4. Data-migration runbook (zero data loss; rollback at every step)

Hard constraint (GOAL boundary 2): downtime OK, **silent data divergence is not**. The old
Swarm `pgdata` volume is preserved untouched until Calum explicitly says otherwise. Single
DB: `control_center`.

| # | Step | Command (shape) | Rollback at this step |
|---|---|---|---|
| 1 | **Quiesce writers** | scale Swarm `api`, `worker`, `media-worker` to 0 (`docker service scale`); leave `postgres` up | restore replicas: scale writers back to 1 |
| 2 | **Capture source counts** | per-table `SELECT count(*)` against Swarm postgres; record in transcript | n/a (read-only) |
| 3 | **Dump** | `pg_dump -Fc control_center` from the Swarm PG into a file held off the pgdata volume | n/a; pgdata untouched |
| 4 | **Bring up CNPG** | CNPG `Cluster` Running, empty DB created | delete the CNPG Cluster + its PVC; nothing migrated yet |
| 5 | **Restore** | `pg_restore` the dump into CNPG | drop/recreate the CNPG DB and re-restore; source untouched |
| 6 | **Verify counts** | per-table `count(*)` from CNPG, shown side-by-side vs step 2 | on ANY mismatch: STOP, do not cut over; source + pgdata intact, investigate |
| 7 | **Preserve source** | `docker volume ls` still shows `control-center_pgdata` | the volume is the rollback artifact; keep it |
| 8 | **Point app at CNPG** | api/worker DATABASE host = CNPG Service; deploy writers on k3s | revert env to Swarm PG host, scale Swarm writers back |

Counts in steps 2 and 6 must be surfaced side by side and **identical**. Old pgdata
preserved (GOAL Phase 4 acceptance). The full cutover (tunnel switch, Swarm teardown) is §7.

---

## 5a. Captive-portal LAN exposure  **[Phase 0a spike: PASSED]**

**Result (verified 2026-06-11):** OrbStack `k8s.enable` + `k8s.expose_services` make a
`LoadBalancer` Service reachable from another LAN device. Enabled via the CLI
(`orbctl config set k8s.enable=true` / `k8s.expose_services=true`); the toggle requires a full
`orbctl stop && orbctl start` to apply (Swarm self-recovered in ~30s, prod stayed at
baseline). The LoadBalancer `EXTERNAL-IP` is the OrbStack VM IP (192.168.139.2), and
`expose_services` **republishes the port on the mini's LAN NIC (en1, 192.168.0.147)**. A curl
from the MacBook to `192.168.0.147:8088` returned **HTTP 200**. This is the LAN reach Swarm
never had ([[orbstack-swarm-lan-port-exposure]] is now obsolete - that workaround is retired).

**Design:**

- captive-portal gets a `Service type: LoadBalancer` exposing `:443` (and `:80` for the
  HTTP→HTTPS redirect). `expose_services` republishes these on the mini's LAN NIC en1
  (192.168.0.147), the host LAN IP the split-horizon DNS record already points at. nginx
  terminates TLS on `:443` using the cert-manager-issued cert (mounted from the cert-manager
  secret, replacing the shared acme.sh volume). No `:42069`, no separate proxy container.
- `portal-lan` (the plain `docker run` proxy, `scripts/portal-lan.sh`) and the `:42069`
  workaround are **deleted**. The `portal-edge` attachable overlay is gone (k8s ClusterIP
  service discovery replaces it).
- Split-horizon DNS already resolves `captive-portal.worldwidewebb.co → 192.168.0.147`
  (UniFi static record, exists). Since `expose_services` republishes on en1 (.147), the
  existing record needs no change. nginx still proxies ONLY `/api/trpc/portal.*` to `api`,
  404ing every other `/api`.

## 5b. media-worker NFS  **[Phase 0b spike: PASSED, with a DESIGN-CRITICAL constraint]**

**Result (verified 2026-06-11):** a native k8s NFS PV mounting from the Synology
(`192.168.0.218`) lists, writes, reads, and deletes from inside a pod - all instant, no hang
(RECON's hang worry did not materialize). **Constraint:** the DS420+ only speaks **NFSv3**.
The default kubelet NFS mount is v4 and fails FAST with "Connection refused". An inline pod
`nfs:` volume **cannot carry mount options**, so EVERY NFS mount in this migration MUST be a
`PersistentVolume` with **`mountOptions: [nfsvers=3, nolock, tcp]`**. This applies to BOTH
the media-worker un-park (CC-6mz7) AND the nightly NAS backup CronJob target (§2).

**Design:**

- media-worker becomes a Deployment with `replicas: 1`, mounting an NFS `PersistentVolume`
  (`server: 192.168.0.218`, `path: /volume1/Homelab` + the media subpath,
  **`mountOptions: [nfsvers=3, nolock, tcp]`**) at `/app/media` - directly, no host bind
  mount, no host LaunchDaemon dependency for the pod. The 1G CC-ke9a cap stays (it's the
  structural OOM/RCU-stall fix). This un-parks CC-6mz7.
- The host `co.worldwidewebb.homelab-drive` NFS LaunchDaemon stays running (boundary 5;
  other things may use the host mount), but the pod no longer depends on it.
- k8s control-plane idle RAM cost on the mini is negligible (free 55%→53% with k8s enabled),
  so this does not threaten the 8GB ceiling on its own.

> **Phase-3 builders:** the `nfsvers=3, nolock, tcp` PV `mountOptions` are mandatory for
> every NFS mount (media-worker AND the backup CronJob). A v4 default mount will get
> "Connection refused" from the DS420+. This is in the AC of every NFS-touching child ticket.

---

## 6. CI pipeline design

Replaces `build-bosun`, `deploy` (digest-collect + webhook POST), `mark-deployed`, the
deploy-marker baseline diff, and `deploy-drift.yml`. **Kept:** path filters, the test gate,
per-app arm64 image builds, GHCR push, **digest pinning** (only changed services roll).

```
push to main
  → changes  (dorny/paths-filter; drop the `bosun`/infra-bosun filter, add an `infra` filter)
  → test     (typecheck · biome · knip · guards · vitest coverage · badges) - unchanged, still gates deploy
  → build-{web,api,worker,media-worker,storybook,drizzle,captive-portal}  (arm64 → GHCR :sha + :main)
      (build-bosun DELETED)
  → deploy   (REPLACED):
       - collect per-image :main digests (same as today: buildx imagetools inspect)
       - join the tailnet with an EPHEMERAL Tailscale auth key (op://Homelab/...), so the
         runner can reach the homelab kube-apiserver over the tailnet
       - `pulumi login` (Pulumi Cloud, op://Homelab/Pulumi/access-token)
       - `pulumi config set` the per-image digest map (digest-pinned image refs)
       - `pulumi up --yes` against the prod stack → only services whose digest changed roll
       - revoke/expire the ephemeral key; leave the tailnet
```

- **Digest pinning preserved:** the digest map becomes Pulumi stack config; a changed digest
  changes the rendered Deployment image, so only that workload's pods roll. Same property as
  today's `docker stack deploy` digest pin, without bosun (CC-czg lineage).
- **Marker logic removed:** `cancel-in-progress` + the `refs/deploy/main` marker existed to
  stop rapid pushes stranding undeployed commits under Swarm's webhook model. With
  `pulumi up` reconciling the whole declared stack to the latest committed digests on every
  green run, the latest run always converges prod to `main` - the marker, `mark-deployed`,
  and `deploy-drift.yml` are no longer needed (RECON decision 6). Keep
  `concurrency: cancel-in-progress` for runner-minute economy; correctness no longer depends
  on the marker because `pulumi up` is declarative-convergent, not push-range-delta.
- **No tailnet secret on a public runner beyond the ephemeral key**: the key is single-use,
  short-TTL, and the node is revoked post-deploy. Pulumi access token + any op refs are GH
  secrets resolved at job time; no secret value is logged.
- **Reboot/path filters:** keep per-app filters; add `infra/**` → triggers a `pulumi up`
  (infra-only change with no image rebuild still converges). Drop the `bosun`/`deploy.config`
  filter entries.

---

## 7. Cutover + reboot test

8GB ⇒ no parallel full stacks (boundary 6). Sequence:

1. **Pre-cutover (no prod impact):** cluster infra (ESO, cert-manager, CNPG operator),
   Pulumi cloudflare/unifi state, and all Deployments are applied to k3s **with cloudflared
   NOT yet holding the live tunnel token** and the portal LB up. Pods Running, but public
   traffic still flows through Swarm cloudflared. (k3s app pods + Swarm can momentarily
   coexist only because most are idle/small; if RAM is tight, scale Swarm app services down
   first - Postgres is the only one that must stay up for the §4 dump.)
2. **Data migration** per §4 (writers→0 on Swarm, dump, restore to CNPG, verify counts).
3. **Tunnel switch (brief overlap window):** move the tunnel token to the in-cluster
   cloudflared (2 replicas); the same tunnel/connector now serves from k3s. This is the only
   moment both connectors might briefly run - keep it short. Verify
   `https://dashboard.worldwidewebb.co` serves from k3s.
4. **Tear down Swarm:** `docker stack rm control-center` (stack ls shows no control-center),
   stop/remove Portainer, stop the `portal-lan` proxy. Old `pgdata` volume **preserved**.
5. **Reboot test (acceptance):** restart OrbStack (or reboot the mini). OrbStack autostart is
   **login-scoped** (auto-login + start-at-login), the same persistence anchor as today, NOT
   a boot daemon - so the reboot test must confirm the node comes back on login and
   `kubectl get pods -A` shows everything Running unattended, with the dashboard URL
   returning 200. Document the auto-login requirement in the recovery runbook.

Host launchd runtimes (HA VM + proxy, unifi socat, NFS mount, orbstack-watchdog, zero) keep
running throughout (boundary 5); their plists come under Pulumi via a `LaunchdJob`
`command.remote` component but the running processes are never interrupted by this migration.

---

## 8. UniFi import plan + www-guest VLAN

**Adopt-only (boundary 1).** Provider `filipowm/unifi` (Terraform provider bridged into
Pulumi). Every existing resource is `pulumi import`-ed, marked `protect: true`, and the
first `pulumi preview` after import MUST show **0 to create / 0 to delete / 0 to replace** on
unchanged config before any apply. Walled garden (`rest/portalconf`) and NetFlow have NO
provider resource → they stay **unmanaged / direct-API** and must NOT appear in Pulumi state.

**Imported (existing, from RECON live dump 2026-06-11, Network 10.4.57 on UCG-Fiber):**

| Resource | Provider type | Notes |
|---|---|---|
| `Default` network 192.168.0.0/24 | `unifi_network` | flat /24, no VLANs today |
| `world-wide-webb` WLAN (wpapsk) | `unifi_wlan` | not guest; BYTE-UNCHANGED is a Phase-5 assertion |
| `captive-portal.worldwidewebb.co → 192.168.0.147` | `unifi_dns_record` | id `6a293c1c37f85e778afb60a2`; split-horizon already done |
| 21 DHCP fixed-IP reservations | `unifi_user` | adopt as-is |
| `guest_access` (portal_enabled=true, redirect_enabled=false) | `unifi_setting_guest_access` | adopt current state; the flip is additive (below) |

Verified zero-diff: the first `pulumi preview` after import shows **1 provider create
(the provider instance, not a UniFi object), 25 imports, 0 update/replace/delete** (CC-j934.3).

**NOT imported (stay direct-API / unmanaged):** walled garden `rest/portalconf` (exact
payload still unpinned), NetFlow IPFIX `:2055`, `traffic_flow`, and **`rsyslogd`**
(gateway → `192.168.0.218:514`, encrypted_only). No Pulumi resource for them. The 2 auto
IPS firewall rules: leave unmanaged. **rsyslogd is unmanaged because
`@pulumiverse/unifi` 0.2.0 cannot round-trip `setting_rsyslogd` on Network 10.4.57**: the
controller stores `contents=null` with `logAllContents=true`, but the provider's `Check`
rejects `enabled:true` without a non-empty `contents` array, so no declaration is both
Check-valid and zero-diff (managing it would mutate the controller, violating Boundary 1).
It stays UNTOUCHED and is verified BYTE-UNCHANGED in Phase 5 via a direct controller GET vs
the RECON baseline. Upstream bug tracked in CC-2gpa.

**RISK:** the provider's external-portal write fidelity on controller 10.4.57 is unverified.
Validate on a throwaway before trusting it for the `guest_access` flip (RECON UniFi notes).

### www-guest: a real isolated VLAN (RECON decision 10)

Additive only. New resources:

- `unifi_network` **www-guest**: own VLAN id + own subnet (a `/24` distinct from
  192.168.0.0/24, e.g. a 192.168.N.0/24 - pick an unused N at apply), `purpose: guest`,
  DHCP server on that subnet, **L2 isolation** (guest clients can't talk to each other or to
  the default LAN), client device isolation on.
- `unifi_wlan` **www-guest** SSID: bound to the www-guest network/VLAN, guest policy on.
- `unifi_setting_guest_access` flip (additive, CC-q002.15): `auth=custom/external`,
  `auth_url = https://captive-portal.worldwidewebb.co`, redirect carrying mac/ap/ssid/t/url
  params. (On-device OTP flow CC-q002.17 needs Calum physically present - `needs input:` for
  that single step, never faked.)

**Cross-VLAN portal path (the fiddly bit - spike before the on-device cutover):** a guest on
the isolated VLAN must reach the portal host (.147) + api **pre-auth**, and nothing else:

1. **Walled-garden pre-auth allowance** (direct-API on `rest/portalconf`, unmanaged): permit
   the portal host `.147` + the api endpoint for unauthenticated guests, so the SPA + its
   `/api/trpc/portal.*` calls load before authorization.
2. **Firewall rule** allowing the www-guest VLAN → `.147` (portal :443/:80) + the api path
   **only**; default-deny all other guest→LAN traffic (preserve isolation). This is the one
   narrow cross-VLAN allowance.
3. **Split-horizon DNS across VLANs:** the existing `captive-portal.worldwidewebb.co → .147`
   static record must answer for clients on the www-guest VLAN too (the gateway resolver
   serves both networks). Confirm the record is VLAN-agnostic at the gateway.

L2 isolation + a single scoped firewall allowance = guests reach only the portal, never each
other or the LAN. **Byte-unchanged guarantee (Phase 5):** `world-wide-webb`, rsyslog, and
netflow configs are read back via the controller GET and compared byte-for-byte against the
RECON dump after the www-guest additions - the new VLAN/SSID must not perturb them.

---

## 9. bosun-removal order

Sequenced so nothing breaks mid-way (RECON "Bosun coupling" sweep). NOTHING in app runtime
imports bosun; the sole code import is `deploy.config.ts:9-21`. Removal happens **only after
k3s is serving prod** (Phase 6), so deletion can't strand the live deploy.

1. **Re-home first (do NOT blind-delete):** before any deletion, the four reconcilers that
   carry real logic must already live in their new home and be proven:
   - `reconcile/access.ts` (CF Access) + `reconcile/routes.ts` (tunnel ingress) → Pulumi
     cloudflare provider (Phase 2, zero-diff import proven).
   - `scheduler.ts` → k8s CronJobs (Phase 3).
   - `reconcile/secrets.ts` (op rail) → ESO (Phase 3).
2. **Switch the deploy path:** the new CI `pulumi up` job (§6) is green end-to-end on a real
   push **before** `build-bosun`/`deploy`/`mark-deployed` are removed. Delete
   `deploy-drift.yml`, the `build-bosun` job, the webhook `deploy` job, `mark-deployed`, and
   the marker baseline diff; update `changes` filters (drop bosun/deploy.config, add `infra`).
3. **Break the code coupling (all in one commit so the repo never half-references bosun):**
   - delete the `deploy.config.ts` import + the file itself
   - remove `vitest.config.ts` bosun project entry, `package.json` bosun script,
     `knip.jsonc` bosun workspace block, `biome.json` bosun override
   - remove the `COPY packages/bosun/package.json` line from all **7** app Dockerfiles
     (api, captive-portal, drizzle, media-worker, web, worker - and the bosun Dockerfile goes
     with the package)
   - delete `packages/bosun/` entirely
4. **Adapt guards:** the `check-no-of` + `elia.sh` third-party-scheduler guard rationale is
   updated (k8s CronJob IS the scheduler now; the guard still blocks reintroducing that
   third-party scheduler). All other guards (fake-data, home-address, personal-email,
   gitleaks, storybook-docs) unchanged.
   Drop `bosun` from the `new-ticket` SKILL.md area list.
5. **Docs rewrite (same phase):** `deployment-design.md` full rewrite (or replace-with-pointer
   to this doc), README deploy section, CLAUDE.md Architecture/Scheduling/Worker paragraphs +
   the third-party-scheduler guard rationale, recovery runbook (reboot/login-scoped note),
   plus touch-ups in logging.md, acceptance-checklist.md, captive-portal/{PRD,runbook,tls}.md,
   unifi-logging.md, ticket-standards.md, and the coverage.sh / portal-lan.sh comments.
6. **bd memories:** DELETE `bosun-deploy-two-phase-config-prune`,
   `bosun-render-changes-lag-one-deploy`, `bosun-secret-prune-before-deploy`; REWRITE
   `auto-deploy-webhook-path`, `access-gate-design-cc-cuuw`; revisit the global
   [[bosun-agent-op-rate-limit]], [[orbstack-swarm-lan-port-exposure]],
   [[portal-healthcheck-busybox-wget-ipv6]] memories.
7. **1P / GH cleanup (last):** delete 1P item "Bosun Webhook Token" + GH secret
   `BOSUN_WEBHOOK_TOKEN` (surface `gh secret list`); delete `scripts/save-bosun-webhook-token.sh`,
   `scripts/test-bosun-entrypoint.sh`, `scripts/bootstrap.sh`, `scripts/rename-portainer-env.sh`;
   keep the GHCR pull token, "Cloudflare API", "CF Access Allowed Email"; drop the
   `BOSUN_WEBHOOK_TOKEN` redact entry in `packages/logger`.

**Done-test (Phase 6):** `rg -li bosun --type ts --type yaml` returns ZERO files; remaining
mentions only in markdown annotated as historical. Gates green and unweakened:
`bun run test`, `typecheck`, `biome check .`, `knip` all exit 0.

---

## 10. Resolved spikes + remaining open items

Both Phase-0 spikes **PASSED** (verified 2026-06-11); the design above reflects their
outcomes, so nothing in §5a/§5b/§2 is provisional anymore.

| Item | Section | Status |
|---|---|---|
| Portal LB reaches the LAN; `portal-lan` + `:42069` deletable | §5a | **PASSED** - curl from MacBook → 192.168.0.147:8088 = HTTP 200 (en1 republish via `expose_services`) |
| media-worker → 1 with native NFS PV | §5b | **PASSED** - un-parks CC-6mz7; PV needs `nfsvers=3, nolock, tcp` (DS420+ is NFSv3-only) |
| Nightly NAS backup via NFS PV | §2 | **PASSED** - direct NFS PV, same `nfsvers=3, nolock, tcp` constraint |
| Provider external-portal write fidelity on 10.4.57 | §8 | **OPEN** - validate on a throwaway before the `guest_access` flip (not a Phase-0 gate) |
| On-device guest OTP flow (CC-q002.17) | §8 | **OPEN** - needs Calum physically present; `needs input:` at that step, never faked |
