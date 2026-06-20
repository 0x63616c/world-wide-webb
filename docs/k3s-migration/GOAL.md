# GOAL, www-j934: replace bosun+Swarm with Pulumi+k3s, end to end, validated

This file IS the goal condition. Inputs: `docs/k3s-migration/RECON.md` (grounded facts +
Calum's approved decisions, follow them; do not re-litigate). Epic: `bd show www-j934`.
Execute via the normal ticket lifecycle; use the `ship`
workflow on www-j934 for the build phases once children are filed, parallelizing where
safe. Every claim below must be PROVEN IN THE TRANSCRIPT (command shown + output shown) -
an assertion without surfaced evidence does not count.

---

## HANDOVER STATUS, 2026-06-12 (epic REOPENED; ~90% done, 4 real gaps left)

The migration is LIVE and serving: prod runs on k3s (homelab OrbStack), dashboard 200 on the
current digest-pinned build, CNPG data migrated with ZERO loss, Swarm torn down, bosun code
removed. But the epic was closed prematurely, strict GOAL reading has **4 substantive gaps +
the Calum-physical items**. Epic reopened. Do NOT re-close until the checklist below is honestly
green or deferred-with-a-real-reason.

### DONE (proven this run)
- Phases 0-3 fully (spikes, DESIGN, Pulumi foundation, CF+UniFi adopt-only zero-diff imports,
  ESO, CNPG, cert-manager, all services on k3s, crons + nightly NAS backup).
- **.8 data migration** Swarm→CNPG, per-table counts IDENTICAL, zero loss, old pgdata preserved.
- **.9 cutover**: tunnel on in-cluster cloudflared (2 HA), Swarm + Portainer gone, **orbctl
  reboot test passed UNATTENDED** (apiserver-forward launchd + HA-PATH fix made it durable).
- **.14 CI** = `pulumi up` over ephemeral tailnet key; build-bosun/mark-deployed/deploy-drift gone.
- **.11 partial**: dashboard tiles real + console clean; lamp-tap reconcile CONFIRMED LIVE by
  Calum; storybook/drizzle 302 CF Access; UniFi world-wide-webb/rsyslog/netflow BYTE-UNCHANGED;
  CI green incl pulumi up.
- **.15/.16**: bosun CODE deleted (packages/bosun, deploy.config.ts, 7 Dockerfile COPYs, tool
  configs), 1P "Bosun Webhook Token" + GH BOSUN_WEBHOOK_TOKEN deleted, docs + recovery runbook
  written, bd memories updated.

### NOT DONE, the 4 real gaps (each has a ticket)
1. **hooks.worldwidewebb.co route NOT retired** (still 502) AND **`rg -li bosun --type ts --type
   yaml` is NOT zero** (8 frozen CF literals + the `bosun:control-center` CF Access ownership
   tag). BOTH blocked on the SAME thing: **www-dqjq**, the CF provider plugin version drifted
   (v5/v6 import-pin footgun), so a `pulumi up` on the cloudflare stack would ALSO rewrite the
   `content` of the LIVE dashboard/storybook/drizzle DNS records (preview proved it: 1 intended
   diff + 7 drift rewrites). MUST re-pin the CF provider + restore the zero-diff Record baseline
   FIRST, then retire hooks + rename the tag as the ONLY diff, eyes-on. Read-only preview is safe;
   the `up` needs watching. (GOAL Phase 5 + Phase 6.)
2. **Captive-portal :443 TLS NOT exposed on the LAN** → **www-j934.20**. `.147:80` serves the portal
   (nginx 200) but `.147:443` is CLOSED. Root cause: OrbStack `k8s.expose_services` republished the
   LoadBalancer's :80 on host :80 but did NOT bind host :443 (only the random NodePort :32244). The
   k8s Service is correct (LoadBalancer 443+80, extIP 192.168.139.2). Fix the host :443 republish so
   `curl -kIv https://captive-portal.worldwidewebb.co` from a LAN device returns 200 + the
   cert-manager LE cert. (GOAL Phase 5.)
3. **www-guest VLAN + SSID NOT applied** → **www-j934.21**. Coded + flag-gated in .3 but UniFi live
   has ONLY `world-wide-webb`. Apply the isolated guest VLAN/SSID (zero-diff preview first,
   adopt-only), verify the controller GET shows `www-guest is_guest=true enabled=true`. (GOAL Phase 5.)
4. **Full-host power-cycle reboot test NOT observed** (power-cycle-verify ticket). orbctl
   stop/start passed unattended; a REAL mini reboot (exercises HA auto-restart via the start-haos.sh
   PATH fix + the apiserver-forward launchd RunAtLoad from cold) is validated by-construction only.
   Calum-physical (reboot the mini). (GOAL Phase 4 "reboot the mini".)

### Calum-physical / needs-input (not agent-doable)
- **www-q002.17** on-device guest-portal OTP flow (GOAL Phase 5, explicitly a needs-input).
- The www-dqjq CF `pulumi up` and the power-cycle want Calum watching / at the mini.

### Other deferred follow-ups (filed)
- **www-ob5o** HA launchd PATH (fixed in start-haos.sh; validate on the power-cycle).
- OrbStack-26443-host-bind durable fix (socat launchd `com.calum.k8s-apiserver-forward` is the
  mitigation; the real OrbStack-binds-:26443-itself fix is the follow-up).
- **www-j934.19** media-worker mountPath (/app/media vs MEDIA_STORAGE_DIR /mnt/media); parked at 0.

### Operational knobs that MUST stay (the hard-won config, see recovery runbook)
- OrbStack VM: `orbctl config set memory_mib 6144` (was 5120, the hidden cap that OOM-crash-looped
  the control plane; THE root cause of the RAM saga).
- HA VM: `-m 2G` in `~/homeassistant-os/start-haos.sh` (was 4G; HA's real working set ~0.7G).
- `com.calum.k8s-apiserver-forward` launchd job (socat 127.0.0.1:26443 → OrbStack VM IP; OrbStack
  doesn't rebind :26443 host-loopback after restart).
- ESO controller limit 256Mi (was 192Mi, OOMKilled on cold-start reconcile).
- `ccinfra:cloudflaredReplicas: "2"` COMMITTED in Pulumi.prod.yaml (an uncommitted local set →
  CI deploy scaled the tunnel to 0 → prod 530).
- CI digest pins go under `ccinfra:imageDigests` (the program reads `Config("ccinfra")`); a bare
  `--path imageDigests.x` lands in the PROJECT namespace and SILENTLY breaks the digest-pin so
  builds never roll.

### How to resume
Re-pin + finish www-dqjq (CF) with Calum watching → fix www-j934.20 (portal :443) → apply www-j934.21
(www-guest) → Calum runs the power-cycle + www-q002.17 OTP → then honestly re-close the epic. The
original phase checklist below is the spec; the 4 gaps above are the only boxes not yet truly ticked.

---

## Phase 0, gating spikes (do FIRST, before any build)

- [ ] **LAN exposure spike:** enable OrbStack k8s + "Expose services to local network
      devices", deploy a throwaway LoadBalancer/NodePort service, and `curl` it
      successfully **from a different LAN device** (MacBook over the LAN IP, not
      localhost). Surface the curl + HTTP 200.
- [ ] **NFS spike:** a pod with a native `nfs` PV for `192.168.0.218:/volume1/Homelab`
      lists and writes a file without hanging (timeout-bounded). Surface the output.
- [ ] If EITHER fails: STOP, write `needs input:` with findings, the platform choice
      reopens. Do not proceed on a failed spike.

## Phase 1, design doc + epic plan

- [ ] `docs/k3s-migration/DESIGN.md` exists on `main`: architecture, per-service mapping
      table (all 10 services + 4 crons → k8s resource type), data-migration runbook with
      rollback at each step, UniFi import plan + www-guest VLAN design (cross-VLAN portal
      path), CI pipeline design, cutover + reboot-test plan, bosun-removal order.
- [ ] Child bd tickets filed under www-j934 (each Ready: type,
      priority, area, checkbox AC), with deps encoding the phase order. Surface `bd list
      --parent www-j934` (or epic tree) output.

## Phase 2, Pulumi foundation (provable without touching prod)

- [ ] `infra/` workspace exists; `pulumi whoami` against Pulumi Cloud succeeds using
      `op://Homelab/Pulumi/access-token` (surface output; NEVER print the token).
- [ ] ComponentResource vocabulary + unit tests; `bun run test` includes them, 0 failed,
      0 skipped.
- [ ] Cloudflare re-home: Access apps/policies/tags + tunnel routes imported into Pulumi
      (`pulumi import`), then `pulumi preview` on the cloudflare stack shows **0 to
      create / 0 to delete / 0 to replace** on unchanged config. Surface the preview.
- [ ] UniFi adopt-only: every existing resource from RECON.md imported with
      `protect: true`; `pulumi preview` shows **zero diffs** before any apply. Surface it.
      Walled-garden + netflow remain unmanaged (no resource for them appears in state).

## Phase 3, cluster + services (excluding cutover)

- [ ] ESO + 1P SDK provider running with the service-account token; `kubectl get
      externalsecret -A` all `SecretSynced/Ready=True`. No secret VALUE ever printed.
- [ ] All services deployed to k3s with images pulled from GHCR (imagePullSecret),
      Secrets mounted at `/run/secrets/<NAME>`, requests/limits matching the www-ke9a
      caps; `kubectl get pods -A` shows every workload `Running` (media-worker may stay
      scaled to 0 only if the NFS spike failed, otherwise it runs).
- [ ] CNPG cluster up; cert-manager `Certificate` for `captive-portal.worldwidewebb.co`
      reaches `Ready=True`; `portal-data-purge` + `map-extract` exist as CronJobs and a
      manual trigger of purge completes (`kubectl create job --from=cronjob/...`,
      surface completion); NO image-prune CronJob exists.
- [ ] Nightly CNPG/pg-dump backup CronJob to the NAS exists and one manual run produces a
      dated artifact on the NAS (surface `ls` of it).

## Phase 4, data migration + cutover (downtime OK, data loss NOT)

- [ ] Pre-migration: per-table `SELECT count(*)` from the Swarm postgres captured in
      transcript. Writers scaled to 0 BEFORE the dump.
- [ ] Post-restore: identical per-table counts from CNPG, shown side by side. The old
      Swarm `pgdata` volume is NOT deleted (surface `docker volume ls` still showing it).
- [ ] Cutover: tunnel token moved to in-cluster cloudflared (2 replicas);
      `https://dashboard.worldwidewebb.co` serves from k3s; Swarm stack removed
      (`docker stack ls` empty / no control-center stack) and Portainer gone.
- [ ] **Reboot test:** restart OrbStack (or reboot the mini), then show `kubectl get
      pods -A` all Running again unattended and the dashboard URL returning 200.

## Phase 5, verification in prod (transcript-described, every surface)

- [ ] agent-browser against `https://dashboard.worldwidewebb.co` @1366×1024: screenshot
      every tile, STATE what each shows (real values, weather, lights, network, etc.),
      browser console clean of new errors. Lights flow verified: toggle a lamp from the
      dashboard and confirm desired-state reconciliation (surface api/DB evidence).
- [ ] storybook + drizzle still 302 to Cloudflare Access login when unauthenticated
      (surface curl -I). hooks.worldwidewebb.co route retired.
- [ ] Captive portal reachable on the LAN over TLS with the cert-manager cert (surface
      curl from LAN device). The www-guest VLAN + SSID exist in UniFi (surface controller
      GET) with the isolated network per DESIGN.md; `world-wide-webb`, rsyslog, netflow
      configs BYTE-UNCHANGED vs RECON.md (surface the GETs). NOTE: the on-device guest
      OTP flow (www-q002.17) requires Calum physically present, when everything else is
      done, `needs input:` for that single step rather than faking it.
- [ ] CI proof: a real push to `main` runs the reworked pipeline green end-to-end
      (surface the run URL + conclusion), including the `pulumi up` deploy step;
      `build-bosun`, `mark-deployed`, `deploy-drift.yml` no longer exist.

## Phase 6, bosun removal + docs (the epic closes here)

- [ ] `packages/bosun/` deleted; `deploy.config.ts` deleted; the 7 Dockerfile `COPY
      packages/bosun` lines gone; vitest/knip/biome/package.json entries removed
      (RECON.md has exact file:line list).
- [ ] `rg -li bosun --type ts --type yaml` over the repo returns ZERO files; remaining
      mentions only in markdown annotated as historical. Surface the rg output.
- [ ] Docs rewritten: `docs/deployment-design.md`, README deploy section, CLAUDE.md
      Architecture/Scheduling paragraphs, third-party-scheduler guard message (scripts/check-no-*.sh), recovery runbook.
      bd memories updated per RECON.md (3 deleted, 2 rewritten). 1P item "Bosun Webhook
      Token" + GH secret `BOSUN_WEBHOOK_TOKEN` deleted (surface `gh secret list`).
- [ ] Gates green and shown: `bun run test` (0 failed, 0 skipped), `bun run typecheck`,
      `bunx biome check .`, `bunx knip`, all exit 0, none weakened (no new test.skip /
      xfail / knip-ignore / biome-disable to get there).
- [ ] All work committed `type(area/www-xxx)` referencing real child tickets, merged
      worktree→main with NO PR, pushed; `git status` clean, up to date with origin.
- [ ] `bd show www-j934` closed; every child closed or explicitly deferred with reason.

## Boundaries (violating any of these = goal NOT met)

1. **Adopt-only UniFi:** no existing UniFi setting modified or deleted, only additive
   (www-guest VLAN/SSID, guest-portal flip per www-q002.15). Zero-diff import proof
   precedes ANY UniFi apply.
2. **Zero data loss:** row-count proof required; old pgdata preserved until Calum says
   otherwise. Downtime is acceptable; silent data divergence is not.
3. **No secrets in transcript, state, or repo**, op refs only; guards stay enforced.
4. **No fake data, no placeholder values** anywhere (check-fake-data stays green).
5. **Host launchd jobs (HA VM, socat proxies, NFS mount, watchdog, zero) keep running**
   throughout, manage their plists via Pulumi `command.remote`, never break the runtimes.
6. **8GB RAM:** never run full Swarm + full k3s stacks simultaneously outside the brief
   cutover window; single-flight heavy operations.
7. Don't delete/skip/weaken any test, gate, or guard to reach green. No `--no-verify`.
8. Pause with `needs input:` ONLY for: failed Phase-0 spike, the on-device www-q002.17
   test, or a destructive step not covered above. Everything else: proceed.
