# GOAL — Migrate all secrets from 1Password to SOPS+age (CC-k8t7)

Full plan: `~/.claude/plans/hazy-splashing-twilight.md`. This file IS the completion contract. Every check below must be **proven in the transcript by running the command and surfacing its output** — the evaluator reads the transcript only; it does not run commands or read files. Never claim a check passed without pasting the command + result.

## End state (one sentence)

1Password is fully off the hot path; `secrets/vault.yaml` (SOPS + PQ age) is the single source of truth; prod is deployed and healthy on the SOPS path; exactly one GitHub Actions secret (`AGE_PRIVATE_KEY`) remains.

## Done = ALL of these proven in transcript

### Vault
- [ ] `SOPS_AGE_KEY=$(security find-generic-password -a "$USER" -s age-world-wide-webb-private-key -w) sops -d secrets/vault.yaml | grep -cE '^(KUBECONFIG__B64|MATCH_GIT_BASIC_AUTHORIZATION):'` prints `2`. (Never paste decrypted values — only the count.)

### Infra code
- [ ] `test ! -e infra/src/eso.ts && test ! -e scripts/seed-op-service-account.sh && echo GONE` prints `GONE`.
- [ ] `grep -rE "ExternalSecret|ClusterSecretStore|onepasswordSDK|external-secrets" infra/ | grep -v '\.test\.' || echo CLEAN` prints `CLEAN`.
- [ ] `grep -E '": "[^"]*/' infra/src/secrets-map.ts || echo CLEAN` prints `CLEAN` (values are flat `VAULT_KEY`, no `Item/field`).
- [ ] `test -f infra/src/vault.ts && echo EXISTS` prints `EXISTS`.
- [ ] `bun run typecheck` exits 0 (output shown).
- [ ] `bun run test` — 0 failed, 0 skipped, no new `.skip`/`xfail`; output shown. No test deleted or weakened to pass.
- [ ] `bunx knip` exits 0 with zero findings (output shown).
- [ ] `bunx biome check .` exits 0 (run from main checkout; output shown).
- [ ] `cd infra && SOPS_AGE_KEY=… pulumi preview --stack prod` succeeds, plan shows native `cc-secrets-*` Secrets created and ESO/ClusterSecretStore/ExternalSecret resources deleted; no errors. Surface the resource summary line.

### CI
- [ ] `grep -rhoE 'secrets\.[A-Z_]+' .github/workflows/ | sort -u` outputs ONLY `secrets.AGE_PRIVATE_KEY` and `secrets.GITHUB_TOKEN`.
- [ ] No `preview` job remains: `grep -c '^  preview:' .github/workflows/ci.yml` prints `0`.
- [ ] `gh secret list` shows only `AGE_PRIVATE_KEY` (the 13 old secrets deleted). Output shown.
- [ ] `AGE_PRIVATE_KEY` is bound to a protected `prod` GitHub Environment (show `gh api repos/0x63616c/world-wide-webb/environments` and the env-scoped secret).
- [ ] `CODEOWNERS` covers `.github/workflows/**`, `secrets/**`, `scripts/secrets.sh`, `infra/src/vault.ts` (show the file).
- [ ] Decrypt steps in workflows use `::add-mask::` and are not wrapped in `set -x` (show the step).

### Local / Tilt / scripts
- [ ] `grep -rnE "op read|op://|op item|op inject" tilt/ scripts/ infra/ | grep -v migrate-1p-to-sops || echo CLEAN` prints `CLEAN`.
- [ ] `test ! -e tilt/op-secrets.tpl && grep -q 'sops -d' products/control-center/tilt/load-secrets.sh && echo OK` prints `OK`.
- [ ] `test -x scripts/set-secret.sh && echo OK` prints `OK`; `grep -l 'op item create\|op item edit' scripts/save-*.sh || echo CLEAN` prints `CLEAN`.

### Docs
- [ ] `grep -rin 'world-wide-webb.yaml' CLAUDE.md || echo CLEAN` prints `CLEAN`.
- [ ] `grep -rinE 'external secrets|ExternalSecret|op://|1Password' CLAUDE.md README.md AGENTS.md CODEBASE_OVERVIEW.md docs/deployment-design.md docs/k3s-migration/DESIGN.md .claude/skills/setup-cc-workspace/SKILL.md` shows no claim that ESO+1P is the *current* secret system (cold-backup mentions of 1P are fine). Surface the residual hits and confirm each is backup-context only.
- [ ] CLAUDE.md documents the age-key location (keychain `age-world-wide-webb-private-key` + 1P Private `SOPS Age world-wide-webb Key`) and the `set-secret.sh` new-secret workflow.

### Prod (the real proof — after push to main)
- [ ] The CI `deploy` run on `main` is green on the SOPS path. Surface `gh run list`/`gh run view` showing the deploy job success.
- [ ] `kubectl get externalsecrets -A` returns nothing AND `kubectl get ns external-secrets` is `NotFound` (ESO uninstalled). Output shown.
- [ ] `kubectl get pods -n control-center` — all Running/Ready, 0 restarts; and `stern -n control-center . ` shows no crashloop/secret errors over ~2 min. Output shown.
- [ ] api pod: `kubectl exec <api-pod> -n control-center -- sh -c 'test -s /run/secrets/HA_TOKEN && echo ok'` prints `ok` (existence + non-empty; the value is NEVER printed).
- [ ] Dashboard live at the prod kiosk URL (`https://app--cc.worldwidewebb.co`), agent-browser screenshot @1366×1024; state in the transcript what the screenshot shows (which tiles, real values), since the evaluator can't see the image.
- [ ] One iOS workflow run (manual `gh workflow run`) is green — fastlane resolved ASC/match from vault. Surface the run result.

### Guards / boundaries (must NOT be violated to get there)
- [ ] No fake/placeholder data introduced: `scripts/check-fake-data.sh` clean; `grep -rE "FALLBACK|PLACEHOLDER" --include='*.ts' --include='*.tsx' products/ infra/ | grep -v -iE 'TilePlaceholder|fallback:' || echo CLEAN` prints `CLEAN`.
- [ ] No secret value ever printed into the transcript (decrypted vault, pod env, or logs). Counts/existence checks only.
- [ ] `no-plaintext-secrets` lefthook + gitleaks pass on every commit.
- [ ] All commits use `type(area/CC-xxx)` (e.g. `chore(infra/CC-k8t7): …`); shipped straight to `main`, NO PR; `git status` clean and `git log origin/main` shows the work pushed.
- [ ] 1Password vault + service accounts left INTACT until every prod check above is green (rollback path preserved); only then is CC-r61o (delete 1P service accounts) actioned.

## Rollback (if prod breaks mid-cutover)
`git revert` the cutover commit + `pulumi up` restores ESO + ExternalSecrets (1P creds still seeded). vault.yaml + age key are unchanged, so no data loss. Do not delete 1P service accounts or old GH secrets until prod is verified green.

## Executor
Work the phases in `~/.claude/plans/hazy-splashing-twilight.md` in order (0→8), prod-safe ordering as written. Track as `bd` subtasks under CC-k8t7; `bd close CC-k8t7` only when every box above is checked, then unblock CC-r61o.
