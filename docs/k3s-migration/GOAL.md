# GOAL, www-j934: replace bosun+Swarm with Pulumi+k3s, end to end, validated

This file IS the goal condition. Inputs: `docs/k3s-migration/RECON.md` (grounded facts +
Calum's approved decisions, follow them; do not re-litigate). Epic: `bd show www-j934`.
Execute via the normal ticket lifecycle (`docs/ticket-standards.md`); use the `ship`
workflow on www-j934 for the build phases once children are filed, parallelizing where
safe. Every claim below must be PROVEN IN THE TRANSCRIPT (command shown + output shown) -
an assertion without surfaced evidence does not count.

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
- [ ] Child bd tickets filed under www-j934 (each Ready per ticket-standards: type,
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
