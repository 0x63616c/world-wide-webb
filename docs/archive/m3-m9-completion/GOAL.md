# GOAL: M3-M9 automation pass (www-jtp0)

**Executor:** use `TeamCreate` (agent team, NOT the `ship` workflow, work spans multiple epics/milestones).
**Decision:** 2026-06-15. Tickets verified live before this goal was written.

## Scope: 14 tickets

All agent-drivable. Human-gated items are explicitly excluded (see OUT section).

| Ticket | Workstream | Type |
|---|---|---|
| `www-jtp0.4.9` | A | Code change |
| `www-7o98` | A | Code change |
| `www-oa74` | A | Code change + pulumi up |
| `www-jtp0.6.6` | B | Verify + close |
| `www-jtp0.7.4` | B | Verify + close |
| `www-jtp0.7.5` | B | Verify + close |
| `www-jtp0.8.7` | B | Verify + close |
| `www-jtp0.6.7` | C | Backup verify |
| `www-jtp0.7.6` | C | Backup verify |
| `www-r3it` | D | Audit |
| `www-0hwo` | D | Audit |
| `www-xomq` | D | Audit |
| `www-jtp0.6.9` | E | Docs/workflow |
| `www-jtp0.6.10` | E | Docs/workflow |

Run workstreams A, B, C, D, E in parallel. Within workstream A, the three tickets are independent and can run in parallel worktrees.

## Workstream A: Code changes

Each ticket requires: worktree named `www-<id>-<slug>`, gates green, commit to main (no PR), push.

### A1: `www-jtp0.4.9`, remove stale `apps/` refs

**Files to change:**
- `package.json` line 6: remove `"apps/*"` from workspaces array
- `.github/workflows/ci.yml` `any_app` filter: remove `'apps/**'` entry (keep `'products/control-center/**'` and any valid products paths)
- If `apps/web/` or `apps/captive-portal/` exist at repo root and are empty/dead dirs: remove them

**Done when (all must appear in transcript):**
- `python3 -c "import json; d=json.load(open('package.json')); print('apps/* gone' if 'apps/*' not in d['workspaces'] else 'FAIL')"` prints `apps/* gone`
- `grep "apps/\*\*" .github/workflows/ci.yml` returns no matches (exit 1 = clean)
- `bun run typecheck` exits 0 (output shown)
- `bun run test` exits 0, 0 failed, 0 skipped (output shown)
- `bunx biome check <explicit changed file paths>` exits 0
- `bunx knip` exits 0
- Commit on main: `chore(ci/www-jtp0.4.9): remove dead apps/* workspace and ci path filter`
- `bd close www-jtp0.4.9` confirmed

### A2: `www-7o98`, fix stale dot-notation host refs in docs

**What to find and fix:** grep for `app\.cc\.worldwidewebb|app\.tye\.worldwidewebb|app\.amp\.worldwidewebb|app\.cp\.worldwidewebb` across all tracked non-worktree files. Functional code refs must be updated to `app--X`. Pure historical/explanatory docs may keep them only with an explicit "previously:" label.

**Done when:**
- `grep -rn "app\.cc\.worldwidewebb\|app\.tye\.worldwidewebb\|app\.amp\.worldwidewebb\|app\.cp\.worldwidewebb" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.sh" --include="*.yml" --include="*.yaml" --include="*.json" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=".claude/worktrees" --exclude-dir=dist` returns 0 matches (output shown)
- `bun run typecheck` exits 0
- `bun run test` exits 0, 0 failed, 0 skipped
- Commit on main: `chore(docs/www-7o98): replace stale dot-notation host refs`
- `bd close www-7o98` confirmed

### A3: `www-oa74`, prune dead CF tunnel routes (portainer + hooks)

**Files to change:** `infra/cloudflare/src/routes.ts`
- Remove `portainer` and `hooks` entries from `LEGACY_INGRESS`
- Remove `portainer` and `hooks` entries from `LEGACY_CNAME_COMMENTS`
- Keep `dashboard`, `storybook`, `drizzle`, `hooks-test` (live or intentional)

Then apply via `cd infra/cloudflare && pulumi up --stack prod --yes` (NO `--target` flag, provider mixing breaks targeted applies).

**Done when:**
- `grep -E '"portainer"|"hooks"' infra/cloudflare/src/routes.ts` returns 0 matches
- `pulumi up --stack prod` output shown, exits 0, no destructive resource changes (only the 2 dead tunnel rules + 2 CNAMEs removed)
- `curl -s -o /dev/null -w "%{http_code}" https://portainer.worldwidewebb.co` returns 404
- `curl -s -o /dev/null -w "%{http_code}" https://hooks.worldwidewebb.co` returns 404
- `bun run typecheck` exits 0
- `bun run test` exits 0, 0 failed, 0 skipped (infra/test/ covers routes)
- Commit on main: `chore(infra/www-oa74): prune dead portainer+hooks CF tunnel routes`
- `bd close www-oa74` confirmed

## Workstream B: Verify + close

Read-only evidence gathering then `bd close`. No code changes.

### B1: `www-jtp0.6.6`, verify TYE infra declared

Run and surface in transcript:
```
kubectl get cluster text-your-ex -n control-center
kubectl get job -n control-center | grep tye-pg-backup
kubectl get svc tye-frontend tye-api -n control-center
curl -s -o /dev/null -w "%{http_code} ssl=%{ssl_verify_result}\n" https://app--tye.worldwidewebb.co
```
All must succeed (cluster exists, backup job Complete, services exist, route 200 ssl=0). Then `bd close www-jtp0.6.6`.

### B2: `www-jtp0.7.4`, verify CC product infra declared

```
kubectl get deployment web api worker -n control-center
kubectl get svc api web -n control-center
curl -s -o /dev/null -w "%{http_code} ssl=%{ssl_verify_result}\n" https://app--cc.worldwidewebb.co
curl -s -o /dev/null -w "%{http_code} ssl=%{ssl_verify_result}\n" https://dashboard.worldwidewebb.co
```
All running, routes live. `bd close www-jtp0.7.4`.

### B3: `www-jtp0.7.5`, verify CC CNPG + backup declared

```
kubectl get cluster control-center -n control-center
kubectl describe cluster control-center -n control-center | grep -i storage
kubectl get job -n control-center | grep "^pg-backup"
```
Cluster exists, storage shows 5Gi, backup jobs Complete. `bd close www-jtp0.7.5`.

### B4: `www-jtp0.8.7`, verify AMP prod cutover

```
curl -s -o /dev/null -w "%{http_code} ssl=%{ssl_verify_result}\n" https://app--amp.worldwidewebb.co
kubectl get deployment amp-app -n control-center
```
302 ssl=0 (CF Access redirect = route live + gated correctly), deployment running. `bd close www-jtp0.8.7`.

## Workstream C: Backup verify

No restore to prod cluster. Verify the backup machinery is healthy end-to-end.

### C1: `www-jtp0.6.7`, verify TYE backup

```
kubectl get job -n control-center | grep tye-pg-backup
kubectl logs job/tye-pg-backup-<latest> -n control-center 2>/dev/null | tail -20
```
Most recent `tye-pg-backup-*` job is Complete (1/1). Surface the log output showing what was backed up (row/size indication). If NAS path is accessible: `ls -lh /Volumes/HomeTB/backups/world-wide-webb/text-your-ex/postgres/` or via SSH to NAS (192.168.0.218). Show backup file exists and is non-zero. `bd close www-jtp0.6.7`.

### C2: `www-jtp0.7.6`, verify CC backup

Same for CC:
```
kubectl get job -n control-center | grep "^pg-backup"
kubectl logs job/pg-backup-<latest> -n control-center 2>/dev/null | tail -20
```
Most recent `pg-backup-*` job Complete. Surface logs. `bd close www-jtp0.7.6`.

## Workstream D: Audits

Each audit produces a reconcile table surfaced in transcript, notes written to the ticket via `bd update <id> --notes "..."`, then closed.

### D1: `www-r3it`, design vs shipped namespace audit

Read `docs/platform/NORTH_STAR.html` or `docs/k3s-migration/MIGRATION_PLAN.html` (M1 section) for the per-product namespace requirement. Compare against:
- `infra/src/cluster.ts`, `APP_NAMESPACE`
- `infra/program.ts`, namespace usage
- `packages/platform/src/index.ts`, product definitions

Surface a table: `design requirement | shipped reality | gap | recommendation`. For each gap: either create a follow-up ticket with `bd create` or document "decided not to implement: reason". Show the table in transcript. `bd close www-r3it`.

### D2: `www-0hwo`, CF IaC completeness audit

**CRITICAL: do NOT call `op` in a retry/poll loop.** ONE call only: `op item get "Cloudflare API" --vault Homelab`, capture output to a variable, parse all fields from it. Never call op again in this task.

Use the token to call:
- `GET /zones/{zoneId}/dns_records` (all types)
- `GET /accounts/{accountId}/access/apps`
- `GET /accounts/{accountId}/access/identity_providers`
- `GET /zones/{zoneId}/settings` (ssl, min_tls_version, always_use_https)

Compare each live resource against `infra/cloudflare/src/{routes,access}.ts` + `program.ts`. Surface reconcile table: `live resource | declared in Pulumi? | action`. Note: One-time PIN IdP is known undeclared (surfaced this session). `bd close www-0hwo`.

### D3: `www-xomq`, UniFi IaC completeness audit

ONE `op item get "UniFi" --vault Homelab` call, capture all fields. Use `local_api_key` (X-API-KEY header) against `https://192.168.0.1`.

Call:
- `GET /proxy/network/api/s/default/rest/networkconf` (networks)
- `GET /proxy/network/api/s/default/rest/wlanconf` (WLANs/SSIDs)
- `GET /proxy/network/api/s/default/rest/firewallrule` (firewall rules)
- `GET /proxy/network/api/s/default/rest/setting/guest_access` (guest portal settings)

Compare against `infra/unifi/src/`. Surface reconcile table. `bd close www-xomq`.

## Workstream E: Docs/workflow

### E1: `www-jtp0.6.9`, TYE iOS workflow

Read `.github/workflows/tye-ios-release.yml`. Verify line 53 cwd is correct (relative `apps/frontend` within `products/text-your-ex` working-dir context = works; make it explicit if ambiguous). The `if: false` gate STAYS, do NOT remove it (removed in E2). No commit needed if no change; if a cwd clarification is made, commit `chore(ci/www-jtp0.6.9): clarify TYE iOS workflow cwd`. `bd close www-jtp0.6.9`.

### E2: `www-jtp0.6.10`, TYE acceptance + flip iOS gate

Check every acceptance criterion in `bd show www-jtp0.6.10` (surface the AC list in transcript, check each). Then:
- Remove `if: false` from `tye-ios-release.yml` (the job gate, enables monthly + path-trigger builds)
- Update any TYE docs that describe the product as "not yet in prod" to "live at app--tye.worldwidewebb.co"
- Commit: `chore(docs/www-jtp0.6.10): TYE acceptance + enable iOS release workflow`
- Push, `bd close www-jtp0.6.10`

## Invariants (never violate)

- **NO `op` in retry/poll loops**, rate-limits hard (happened this session). ONE `op item get` per item. If rate-limited: wait 60s, try once, then skip that step and note it.
- **NO PRs**, merge to main locally, push.
- **Commit format:** `type(area/www-xxx): desc`. Lefthook validates the bd ticket id is real.
- **`bun run test`** (NOT bare `bun test`), vitest only; bare `bun test` breaks `vi.mock`.
- **biome in worktrees:** run on explicit file paths, NOT `.` (biome ignores `.claude/worktrees/` paths silently).
- **`bun install --frozen-lockfile`** in each worktree before running tests (else `@repo/platform` resolves stale from main checkout).
- **No fake/placeholder data:** `scripts/check-fake-data.sh` must still pass.
- **No em-dashes** in commits/files (lefthook blocks them).
- **No loose `pkill`/`git stash`** (shared machine, multiple sessions run concurrently).
- **`bd dolt push`** after any `bd create`/`bd close` before any `git push` (beads sync race prevention).
- **Pulumi apply:** in `infra/cloudflare/`, NEVER use `--target` (provider mixing breaks it). Use `pulumi up --stack prod --yes`.
- **CNPG restore:** do NOT attempt a live restore to prod clusters. Backup verify only (job logs + NAS file existence).

## Explicitly OUT (do not touch)

- `www-jtp0.7.7`, CC prod data cut (irreversible, needs Calum's explicit go + window)
- `www-jtp0.7.9`, CC workers smoke (blocked by 7.7)
- `www-jtp0.7.10`, iPad wall panel physical test
- `www-jtp0.5.*`, captive portal LAN/UniFi/physical cutovers
- `www-jtp0.3.6/3.7`, portal + kiosk cutovers
- `www-jtp0.9.*`, M9 rename/polish (needs Calum's naming decisions)
- `www-6uud`, kiosk service-token policy (op rate-limit issue, separate session)
- `www-cfor`/`www-5l48`, TYE API public route (intentionally internal)
- `www-1ck3` (M10), project-management prod (blocked by M9)
- `www-b6ad`, Access gate (in progress separately)

## Done signal

All of the following must appear in transcript:
1. `bd list --status=closed 2>/dev/null | grep -E 'www-jtp0\.4\.9|www-7o98|www-oa74|www-jtp0\.6\.6|www-jtp0\.6\.7|www-jtp0\.6\.9|www-jtp0\.6\.10|www-jtp0\.7\.4|www-jtp0\.7\.5|www-jtp0\.7\.6|www-jtp0\.8\.7|www-r3it|www-0hwo|www-xomq'` shows all 14 as closed
2. `git log --oneline -10` on main shows the workstream A commits
3. `git status` shows clean tree
4. `git push` succeeded (remote output shown)
5. No ticket closed without its evidence criterion being met in transcript (the evaluator checks each)
