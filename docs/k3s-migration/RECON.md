# k3s migration, recon facts + approved decisions (www-j934)

Verified 2026-06-10/11 by a 4-agent recon team + live API checks. These are the grounded
inputs for the migration; the goal contract is `GOAL.md` next to this file. Re-verify
anything load-bearing that is more than a few weeks old.

## Approved decisions (Calum, 2026-06-11)

1. **Platform:** OrbStack built-in Kubernetes on homelab (Mac mini), gated on two spikes
   (LAN exposure + NFS-from-pod, below). Either failing reopens the platform choice.
2. **IaC:** Pulumi TypeScript, in this monorepo under `infra/`. ComponentResource
   vocabulary succeeds `service()`/`cronJob()` from `deploy.config.ts`.
3. **State:** Pulumi Cloud. Account exists, 1P item `Pulumi` (Homelab vault), username
   `the-workflow-engine`, field `access-token` (`op://Homelab/Pulumi/access-token`).
   Reversible later via `pulumi stack export/import`.
4. **Secrets:** External Secrets Operator with the 1Password **SDK provider**
   (service-account token, NO Connect server), syncing native k8s Secrets, mounted at the
   existing `/run/secrets/<NAME>` paths so images need zero changes. This also fixes the
   op rate-limit churn (cluster reads 1P once; pods read etcd).
5. **Postgres:** CloudNativePG on a local-path PVC on the mini's SSD (NOT NFS, corruption
   footgun + DS420+ is 2GB RAM). NEW: nightly backups to the NAS (today `autobackup:false`
  , no backups exist). Migration = scale writers to 0 → `pg_dump` → restore → per-table
   row-count verification → keep old Swarm `pgdata` volume untouched as rollback.
6. **Deploy:** GitHub Actions push model, build images → digests → `pulumi up` over an
   ephemeral Tailscale key. `refs/deploy/main` marker, `mark-deployed`, `deploy-drift.yml`
   retired. Digest pinning (only changed services roll) preserved.
7. **Crons:** `docker-image-prune` DELETED (kubelet image GC replaces it; k8s docs warn
   external prune tools break kubelet). `portal-cert-renew` → cert-manager (CF DNS-01).
   `portal-data-purge` + `map-extract` → k8s CronJobs.
8. **Cloudflare:** Access apps/policies/tags + tunnel ingress re-homed from
   `packages/bosun/src/reconcile/{access,routes}.ts` to the Pulumi cloudflare provider.
   cloudflared runs in-cluster, Deployment, 2 replicas (HA only, never autoscale).
9. **UniFi:** managed via `filipowm/unifi` (TF provider bridged into Pulumi), **ADOPT-ONLY**:
   `pulumi import` every existing resource, mark `protect: true`, and the first
   `pulumi preview` after import MUST show zero diffs before any apply. Walled garden
   (`rest/portalconf`) and NetFlow have NO provider resource → stay unmanaged/direct-API.
10. **www-guest gets a real isolated VLAN** (own `unifi_network` + VLAN id + subnet, guest
    policy, L2 isolation), NOT the flat /24. Requires explicit narrow path from guest
    VLAN → portal host (.147) + api: walled-garden pre-auth, firewall allowance for the
    portal flow only, split-horizon DNS answering across VLANs. Cross-VLAN reachability is
    the fiddly bit; spike before the on-device cutover (www-q002.17, needs Calum present).
11. **launchd:** runtimes stay host-level (they cannot live in-cluster), but the plists +
    scripts come under Pulumi via `command.remote` (SSH over Tailscale) with a `LaunchdJob`
    component, declared in `infra/`, not hand-maintained.
12. **Portainer retired** at cutover. **Downtime OK; zero data loss is the hard constraint.**
13. **OUT of scope v1:** Hetzner/cloud cluster (design components so it's cheap later),
    HA YAML-as-code, NAS/DSM provider (DS420+ is DSM 7.1-42661; provider targets 7.2
    Container Manager), Tailscale ACLs, GitHub-repo-as-code, the `zero` project.

## Mac mini (homelab) host inventory

- **Apple M2, 8GB RAM**, 228GB disk (138GB free), macOS 15.6. OrbStack 2.1.1, kubectl
  client v1.33.9 already installed. **8GB ⇒ NO parallel-run** of Swarm + k3s; cutover is
  stop-Swarm → start-k3s.
- **Home Assistant = HAOS qemu VM** (`com.homeassistant.os` LaunchAgent, KeepAlive) +
  `com.homeassistant.proxy` (socat TCP-LISTEN:8123). Pods reach HA via host LAN IP :8123
  (use a headless Service + Endpoints, NOT host.docker.internal, flaky from pods).
- Other launchd: `co.worldwidewebb.orbstack-watchdog` (30s), `com.unifi.proxy` (socat
  :8444), `co.worldwidewebb.homelab-drive` LaunchDaemon (mounts
  192.168.0.218:/volume1/Homelab at /Users/calum/control-center/media, 60s), `zero` +
  `zero.sampler` (separate project, untouched). No crontab.
- Non-swarm containers: `portal-lan` (nginx:1.27-alpine, :80 + :42069, dies if the LAN
  toggle spike passes), Portainer 2.27.3 (retire).
- Volumes: `control-center_pgdata`, `control-center_portal-certs`, `control-center_drizzle-data`
  (+ stray `portal-certs`, `cc_nfs_test` leftovers).

## OrbStack k8s feasibility (researched, needs the two spikes to confirm)

- **LAN exposure:** OrbStack Settings → Kubernetes → **"Expose services to local network
  devices"**, the toggle Swarm never had (Swarm published ports provably do NOT reach the
  LAN; that's why portal-lan exists). SPIKE: LoadBalancer svc curled from another LAN
  device. If it works, `portal-lan` + the :42069 hack die.
- **NFS:** native `nfs` PV mounts from inside the cluster bypass the OrbStack host
  bind-mount path that HANGS today (likely un-parks media-worker / www-6mz7). SPIKE: pod
  mounting the Synology export, ls + write, no hang.
- cert-manager CF DNS-01 mature; CF API token needs Zone.DNS:Edit + **Zone.Zone:Read**.
- kubelet GC defaults: high 85% / low 80%, eval 5m.
- OrbStack autostart is login-scoped (auto-login + start at login), not a boot daemon -
  same as today; reboot test is part of acceptance.

## UniFi current state (live dump 2026-06-11, Network app 10.4.57 on UCG-Fiber)

- 3 networks: 2× WAN + `Default` flat 192.168.0.0/24, **no VLANs anywhere**. 1 WLAN
  `world-wide-webb` (wpapsk, not guest). 2 auto IPS firewall rules (leave unmanaged).
  No port forwards / firewall groups / static routes. 21 DHCP fixed-IP reservations.
- Static DNS: `captive-portal.worldwidewebb.co → 192.168.0.147` ALREADY EXISTS (id
  `6a293c1c37f85e778afb60a2`). Split-horizon is done.
- Log export (UNTOUCHED by this migration, gateway streams direct to NAS): rsyslogd →
  192.168.0.218:514 (encrypted_only), netflow IPFIX → :2055 (sampling 512), traffic_flow on.
- `guest_access` today: portal_enabled=true but `redirect_enabled=false`, external-portal
  mode NOT yet flipped. Future flip (www-q002.15): auth=custom/external, auth_url =
  `https://captive-portal.worldwidewebb.co`, redirect carries mac/ap/ssid/t/url params.
- Provider mapping: ~90% covered (`unifi_network`, `unifi_wlan`, `unifi_dns_record`,
  `unifi_user`, `unifi_setting_rsyslogd`, `unifi_setting_guest_access`). GAPS (stay
  direct-API/manual): walled garden (`rest/portalconf`, exact payload still unpinned),
  netflow, traffic_flow. RISK: provider's external-portal write fidelity on 10.4.57 is
  unverified, validate before trusting.
- Raw dumps (session-scoped, regenerate if needed): the API is GET-able with
  `X-API-KEY` = `op://Homelab/UniFi/local_api_key` against `https://192.168.0.1`.

## Bosun coupling (full sweep, the removal checklist)

`packages/bosun` = ~4860 LOC, 12 src modules + 20 test files. NOTHING in app runtime
imports it; sole code import is `deploy.config.ts:9-21`.

**Breaks instantly on delete:** `deploy.config.ts` import; `vitest.config.ts:12` project
entry; `package.json:11` bosun script; `knip.jsonc:53-57` workspace block (knip gates
deploys); `biome.json:77-86` override; **all 7 app Dockerfiles** `COPY
packages/bosun/package.json` (api:19, captive-portal:22, drizzle:5-6, media-worker:19,
web:18, worker:20).

**Re-home (don't blind-delete):** `reconcile/access.ts` (271L, CF Access) +
`reconcile/routes.ts` (272L, tunnel ingress) → Pulumi cloudflare; `scheduler.ts` (417L) →
k8s CronJob; `reconcile/secrets.ts` (184L, op rail) → ESO.

**CI (`.github/workflows/ci.yml`, 610L):** delete `build-bosun` (421-454); replace `deploy`
(527-582: digest collect + webhook POST to hooks.worldwidewebb.co with
`BOSUN_WEBHOOK_TOKEN`); delete `mark-deployed` (595-610) + marker baseline diff (47-69);
update `changes` filters (40, 122-126, 147). Delete `deploy-drift.yml`.

**Docs:** `deployment-design.md` full rewrite; README deploy section; CLAUDE.md
Architecture/Scheduling/Worker paragraphs + third-party-scheduler guard rationale; touch-ups in logging.md,
acceptance-checklist.md, captive-portal/{PRD,runbook,tls}.md, unifi-logging.md,
ticket-standards.md, coverage.sh + portal-lan.sh comments.

**Guards:** third-party-scheduler-guard ADAPT (new rationale: k8s CronJob is the scheduler; guard still
blocks that-scheduler). All other guards keep. Drop `bosun` from new-ticket SKILL.md area list.

**bd memories:** DELETE `bosun-deploy-two-phase-config-prune`,
`bosun-render-changes-lag-one-deploy`, `bosun-secret-prune-before-deploy`; REWRITE
`auto-deploy-webhook-path`, `access-gate-design-cc-cuuw`; revisit global
`bosun-agent op rate-limit`, `orbstack-swarm-lan-port-exposure`,
`portal-healthcheck-busybox-wget-ipv6`.

**1P / GH cleanup:** delete item "Bosun Webhook Token" + GH secret `BOSUN_WEBHOOK_TOKEN`;
delete `scripts/save-bosun-webhook-token.sh`, `scripts/test-bosun-entrypoint.sh`,
`scripts/bootstrap.sh`, `scripts/rename-portainer-env.sh`; keep GHCR pull token,
"Cloudflare API", "CF Access Allowed Email"; drop the `BOSUN_WEBHOOK_TOKEN` redact entry
in `packages/logger` (comment-only coupling otherwise).
