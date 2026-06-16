# GOAL: Finish M3/M5/M7/M9 — get to done

Written: 2026-06-15. Grounded in live bd state + code verification this session.
Prior GOAL.md tickets are all shipped. This covers what remains.

---

## Phase 1: NOW (30 min, Calum present)

Three decisions needed from Calum. Each unblocks a chain of work.

### Decision 1: M9 image naming — approve convention

Convention already decided: `www-<product-code>-<image>` (e.g. `www-cc-api`, `www-tye-frontend`).
Current names: `control-center-api`, `control-center-worker`, etc.

**Calum must say:** "approved" for www-jtp0.9.5 to proceed.
Unblocks: www-jtp0.9.5 → www-jtp0.9.6 → www-jtp0.9.8 → www-jtp0.9.9.

### Decision 2: Captive portal LAN TLS — review infra code for www-jtp0.5.8

I present the cert-manager + nginx changes for `app--cp.worldwidewebb.co`.
Calum reviews, says "apply it" or "change X".
Unblocks: www-jtp0.5.8 → www-jtp0.5.9 (UniFi DNS flip) → www-jtp0.5.10 → www-jtp0.5.11.

### Decision 3: CC prod DB migration window — schedule www-jtp0.7.7

Needs a short write-freeze window (< 5 min). Pick a time.
Unblocks: www-jtp0.7.7 → www-jtp0.7.9 → www-jtp0.7.10 → www-jtp0.7.11.

---

## Phase 2: Auto-ship (I run, no human needed)

These I ship autonomously, in parallel, during or after the 30-min session.

| Ticket | Work | Risk |
|---|---|---|
| `www-7d5b.4` | Remove vestigial in-flight-command machinery from light enforcer | Low — code cleanup only |
| `www-jtp0.3.8` | Write legacy hostname retirement checklist | Low — docs only |
| `www-jtp0.3.9` | Update networking/TLS docs + platform runbooks | Low — docs only |
| `www-jtp0.7.11` | Update CC product docs, create dashboard.worldwidewebb.co retirement checklist | Low — docs only |
| `www-jtp0.8.8` | ✓ Already closed this session | — |
| `www-jtp0.9.7` | Polish docs/scripts for world-wide-webb naming | Low — docs + cosmetic |

Each requires: gates green (`bun run test` 0 failed 0 skipped, `bun run typecheck`, `bunx biome check`, `bunx knip`), commit `type(area/www-xxx): desc`, push, `bd close`.

---

## Phase 3: Needs approval mid-flight (I prep, Calum approves before apply)

### www-jtp0.5.8 — Captive portal LAN TLS apply (after Decision 2 above)

Once Calum approves the code:
- `pulumi up` on infra/certmanager → issues `app--cp.worldwidewebb.co` cert
- nginx server_name includes `app--cp.worldwidewebb.co`
- No cloudflared tunnel route created for app--cp
- `openssl s_client -connect 192.168.0.147:443 -servername app--cp.worldwidewebb.co` shows cert valid, subject matches
- `bd close www-jtp0.5.8`

Then Calum manually flips `addAppCpDnsRecord: true` in UniFi Pulumi config → `pulumi up` (www-jtp0.5.9).

### www-jtp0.9.5 — CI image rename (after Decision 1 above)

Phase 1: audit current image names in CI + infra, surface full list in transcript.
Phase 2: rename CI workflow image build names, Pulumi digest map keys, all references.
Phase 3: Calum reviews diff → approves → I run `pulumi up` to confirm no destructive resource replacements.
Phase 4: push, CI green (renamed images build), deploy rolls on new names.

Done signal: `grep -r "control-center-api\|control-center-worker\|control-center-web" .github/workflows/ infra/` returns 0 matches in functional contexts.

### www-jtp0.9.6 — Pulumi project rename (after 9.5)

Migration notes already in `docs/m3-m9-completion/` from prior session.
I prep the rename (Pulumi project name, `ccinfra:` → `wwwinfra:` config prefix, state aliases).
Calum reviews `pulumi preview` output before I run `pulumi up`.

### www-jtp0.5.9 — UniFi DNS flip (after 5.8 verified)

Flag `addAppCpDnsRecord` already coded and defaulted false in `infra/unifi/src/unifi.ts`.
Calum says "flip it" → I set it true, run `pulumi up --stack prod` on infra/unifi, show DNS record created.
Then verify from a guest device or curl that `app--cp.worldwidewebb.co` resolves to `192.168.0.147`.

---

## Phase 4: Prod windows (Calum present, short execution)

### www-jtp0.7.7 — CC prod DB migration (~20 min window)

Pre-run checklist (I prepare in advance):
- Final snapshot of current CC DB to NAS
- Restore rehearsal to staging CNPG already verified
- Rollback script ready

Day-of steps (Calum runs or watches):
1. Scale down CC workers + api writers
2. Final SQL dump → NAS
3. `pg_restore` into product CNPG cluster
4. Validate row counts + semantic queries
5. Deploy api/worker against product DB
6. `kubectl rollout status` all services
7. Wall panel renders correctly (Calum checks iPad)

Done signal: `kubectl get cluster control-center-product -n control-center` shows `Ready`, CC tile data live.

### www-jtp0.5.10 — Guest onboarding cutover (~10 min)

After 5.8 + 5.9 done. Connect a real device to www-guest, complete onboarding flow at app--cp.worldwidewebb.co, verify email sent, device gets internet access. Calum watches.

### www-jtp0.7.10 — Wall panel verify at 1366×1024 (2 min)

After 7.7. Calum looks at iPad. No broken tiles, no skeletons, live data. Done.

### www-jtp0.9.8 — Prod cutover on renamed identity (~10 min)

After 9.5 + 9.6. CI green with new image names, `pulumi up` with new project name — Calum approves the preview, I watch the deploy roll. Verify every product still up after rename.

### www-jtp0.9.9 — Remove old aliases (~5 min, Calum approves)

After 9.8 stable for one successful CI run. Delete old image aliases, GHCR legacy names, stale Pulumi config keys. Calum approves the diff.

---

## Invariants (never violate)

- **`bun run test`** NOT bare `bun test` (vi.mock breaks)
- **No PRs** — merge to main locally, push
- **Commit format:** `type(area/www-xxx): desc` with real bd ticket id
- **biome in worktrees:** run on explicit file paths, not `.`
- **No `op` in loops** — one `op item get` per item, capture to variable
- **No loose `pkill`/`git stash`** — shared machine
- **Pulumi:** never `--target` in infra/cloudflare (provider mixing breaks it)
- **No fake data:** `scripts/check-fake-data.sh` passes
- **Gates:** typecheck + test (0 failed, 0 skipped) + biome + knip all green before every commit

## Done signal (full project complete)

All must appear in transcript:
1. `bd epic status www-jtp0 2>&1` shows M3/M5/M7/M9 all closed
2. `bd list --label=milestone --status=open` returns 0 results
3. `git log --oneline -5` shows commits for each auto-ship ticket
4. `git status` clean, `git push` succeeded
5. `kubectl get pods -n control-center` all Running/Completed, 0 CrashLoopBackOff
6. `curl -s -o /dev/null -w "%{http_code}" https://app--cc.worldwidewebb.co` returns 200 or 302
7. `curl -s -o /dev/null -w "%{http_code}" https://app--cp.worldwidewebb.co` N/A (LAN only) — Calum confirms from device
8. `bd epic close-eligible` returns 0 open epics eligible to close
