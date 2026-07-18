# M9 Production Cutover Checklist (www-jtp0.9.8)

**Status: REQUIRES CALUM - execute in order, gate at each step.**

Prerequisites: www-jtp0.9.3 (badges/refs), www-jtp0.9.4 (package scopes),
www-jtp0.9.5 (image names), www-jtp0.9.6 (Pulumi prep) all merged and green.

---

## Pre-cutover baseline

- [ ] `pulumi preview --stack prod` shows 0 replacements (run from `infra/`)
- [ ] `pulumi preview --stack prod` shows 0 replacements for `infra/cloudflare/` and `infra/unifi/`
- [ ] All products responding: dashboard at `https://dashboard.worldwidewebb.co`, captive portal, AMP
- [ ] CI green on `main`
- [ ] `python3 scripts/check-rename-identity.py` exits 0 (no UNCLASSIFIED)

---

## 1. GitHub repository rename (www-jtp0.9.3)

- [ ] Calum approves GitHub rename
- [ ] Rename `0x63616c/control-center` → `0x63616c/world-wide-webb` in GitHub Settings
- [ ] GitHub sets up redirect from old URL automatically
- [ ] Verify: `curl -s -o /dev/null -w '%{http_code}' https://github.com/0x63616c/control-center` returns 301
- [ ] Update README badge URLs from `0x63616c/control-center` → `0x63616c/world-wide-webb`
- [ ] Update any `git remote` in local clones: `git remote set-url origin git@github.com:0x63616c/world-wide-webb.git`
- [ ] CI re-runs on a push to verify badge/workflow URLs resolve
- [ ] `bun run badges` regenerates `.github/badges/*.json` with new repo URL (or verify CI does it)

## 2. Package scope rename (www-jtp0.9.4)

Pre-approved convention required from Calum before this step.

- [ ] Calum approves final package naming convention
- [ ] Rename `@repo/*` packages to approved platform scope (e.g. `@www/*` or `@platform/*`)
- [ ] Rename `@cc/*` packages to approved product scope
- [ ] Update all import statements across the monorepo
- [ ] Root `package.json` `name: control-center` → `world-wide-webb`
- [ ] `bun install` (to update lockfile)
- [ ] `bun run typecheck` - must pass
- [ ] `bunx biome check .` - must pass
- [ ] `bun run test` - must pass
- [ ] `bunx knip` - must pass (zero dead code)

## 3. GHCR image rename (www-jtp0.9.5)

- [ ] Calum approves GHCR image cutover
- [ ] Update CI `ci.yml` `Collect image digests` step: replace `control-center-*` repo names with `world-wide-webb-*`
- [ ] Update CI docker build tags from `ghcr.io/0x63616c/control-center-*` to `ghcr.io/0x63616c/world-wide-webb-*`
- [ ] Update `infra/src/services.ts` image base names to match new tags
- [ ] Push to `main` - CI must build AND publish all new image names
- [ ] Verify: `docker buildx imagetools inspect ghcr.io/0x63616c/world-wide-webb-web:main`
- [ ] Verify: digest collection step produces valid digest map for all services
- [ ] `pulumi preview --stack prod` with new digest map - must show image updates only, no replacements of other resources
- [ ] `pulumi up --stack prod` - products must stay healthy after image rollout
- [ ] Old `control-center-*` GHCR images remain published (rollback path) until Step 6

## 4. Pulumi project rename (www-jtp0.9.6)

See `docs/m9-pulumi-migration.md` for detailed steps.

- [ ] Run previews with current identity (baseline)
- [ ] Calum approves Pulumi project rename in Pulumi Cloud
- [ ] Rename all three projects in Pulumi Cloud UI
- [ ] Update `infra/Pulumi.yaml`, `infra/cloudflare/Pulumi.yaml`, `infra/unifi/Pulumi.yaml`
- [ ] `pulumi preview --stack prod` - MUST show 0 replacements
- [ ] `pulumi up --stack prod` - products stay healthy
- [ ] Decision on `ccinfra:` namespace rename (conservative: leave as-is)

## 5. Smoke tests post-cutover

Run `scripts/cc-post-cutover-smoke.sh` (or equivalent):

- [ ] Dashboard loads at `https://dashboard.worldwidewebb.co`
- [ ] tRPC health endpoint responds: `curl https://dashboard.worldwidewebb.co/trpc/health`
- [ ] All tiles on wall panel render (no shimmer-only tiles)
- [ ] Postgres CNPG cluster healthy: `kubectl get cluster -n control-center`
- [ ] Workers running: `kubectl get pods -n control-center | grep worker`
- [ ] Cloudflared tunnel connected: `kubectl get pods -n control-center | grep cloudflared`

## 6. Identity audit final pass

- [ ] `python3 scripts/check-rename-identity.py` exits 0 with no UNCLASSIFIED
- [ ] `bun run test` green
- [ ] CI green on `main`

---

## Rollback (if any step fails)

**GitHub rename**: rename back in GitHub Settings (bidirectional).

**Image rename**: repoint `infra/src/services.ts` image bases to `control-center-*`
names, which are still published, and run `pulumi up`.

**Pulumi project rename**: rename back in Pulumi Cloud UI; local `Pulumi.yaml`
reverts are a single git revert.
