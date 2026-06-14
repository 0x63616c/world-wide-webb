# M9 Cleanup Checklist (www-jtp0.9.9)

**Status: REQUIRES CALUM - destructive, execute only after production is
stable on the renamed identity for at least one week.**

Pre-condition: www-jtp0.9.8 (cutover) fully complete, all smoke tests pass,
no incidents in 7 days.

---

## 1. Old GHCR image cleanup

Old `ghcr.io/0x63616c/control-center-*` images remain published as rollback
path until this step.

- [ ] Confirm all products have been running on `world-wide-webb-*` images for
  at least one full deploy cycle with no rollback needed
- [ ] For each old image repo, decide: prune `:main` tag only, or delete the
  whole package
  - `control-center-web`
  - `control-center-api`
  - `control-center-worker`
  - `control-center-media-worker`
  - `control-center-storybook`
  - `control-center-drizzle`
  - `control-center-captive-portal`
  - `control-center-map-provision`
  - `control-center-tye-api`
  - `control-center-tye-frontend`
- [ ] Delete or archive each package in GitHub Packages UI or via `gh api`
- [ ] Verify no infra code references old image base names

## 2. Pulumi config namespace cleanup (if `ccinfra:` was renamed in 9.6)

Only relevant if Step 4 of the cutover included namespace rename.

- [ ] All `ccinfra:*` config keys removed from all stacks:
  ```bash
  pulumi config ls --stack prod  # should show only wwwinfra: keys
  ```
- [ ] `infra/src/services.ts`, `infra/src/cluster.ts`, `infra/src/certmanager.ts`
  comments updated to remove `ccinfra:` references
- [ ] `allowed-compatibility-alias` for `ccinfra` removed from `rename-identity-allowlist.tsv`

## 3. Pulumi resource aliases cleanup (if aliases were added in 9.6)

- [ ] `pulumi preview --stack prod` shows 0 changes (no aliases needed)
- [ ] Remove any temporary aliases from `infra/src/` components
- [ ] `pulumi up --stack prod` - clean apply, products healthy

## 4. Identity allowlist tightening

After all renames are live, tighten `scripts/rename-identity-allowlist.tsv`:

- [ ] Remove `allowed-compatibility-alias` entries for old identity where the
  compatibility period has ended
- [ ] Move `repo-platform-identity` entries that are now complete to
  `historical-only-docs` (they will be stable, not pending rename)
- [ ] Update `scripts/check-rename-identity.py` identity pattern to drop
  `0x63616c/control-center` (replace with `0x63616c/world-wide-webb` if needed)
- [ ] `python3 scripts/check-rename-identity.py` exits 0 after tightening
- [ ] Consider adding `world-wide-webb` to the identity scan pattern to catch
  future references to the renamed identity in wrong places

## 5. Old GitHub repo redirect retirement

GitHub automatically redirects `0x63616c/control-center` → `0x63616c/world-wide-webb`
for 12 months. After the redirect period ends (or after confirming all external
users have updated):

- [ ] Verify no active CI, deploy, or external service still uses old URL
- [ ] Update any documentation that still references the old clone URL
- [ ] `scripts/rename-identity-allowlist.tsv` `historical-only-docs` entries for
  old repo URL can be removed or the audit pattern updated

## 6. `.agents/skills/` description updates

- [ ] `setup-cc-workspace/SKILL.md` description line updated from
  "control-center" to "world-wide-webb" or "the dashboard"
- [ ] `finish-ticket/SKILL.md` and `new-ticket/SKILL.md` description lines
  updated if they still reference "control-center" as repo name

## 7. Final verification

- [ ] `python3 scripts/check-rename-identity.py` exits 0 with tightened allowlist
- [ ] `bun run test` green
- [ ] `bunx knip` green
- [ ] CI green on `main`
- [ ] All products healthy on renamed identity

---

## Items intentionally NOT cleaned up (keep `control-center` name)

The following keep their `control-center` identity permanently because they are
**product identity** (not repo identity) or live in production state that is
outside this scope:

- Kubernetes namespace `control-center` (CNPG, workload namespace)
- CNPG cluster name, Postgres database name `controlcenter`
- `products/control-center/` directory path (product folder)
- `@control-center/*` package scope (renamed via www-jtp0.9.4 to new scope)
- Backup filenames containing `control_center` (historical, append-only)
- Historical docs that reference the old product or repo name by context
