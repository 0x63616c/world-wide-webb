# WWW-84 merge verification

Merged `origin/main` at `2198c166` into `WWW-84-deploy-strategy` on 2026-11-01.
The workflow uses main's rollout helper, retaining the atomic Recreate patch,
preview, and worker recovery. The WWW-84 regression test now follows that helper.

All commands ran from the ticket worktree after `source .job.env` and
`export PATH="$HOME/.cargo/bin:$PATH"`. Bun was 1.4.2 (CI pins 1.4.4).

| Command | Exit result |
| --- | --- |
| `bun install --frozen-lockfile` | 0 |
| `bun run lint` | 0 |
| `bash scripts/check-alias-parity.sh` | 0 |
| `bun run test:dockerfile-manifests` | 0 |
| `bash scripts/test-deploy-gate.sh` | 0 |
| `bash scripts/test-deploy-www.sh` | 0; five rollout scenarios |
| `bash scripts/test-build-matrix.sh` | 0 |
| `node scripts/test-panel-health.mjs` | 0 |
| `bun run apps:check` | 0 |
| `bun run test:unit` | 0; 180 files passed, five skipped; 1,861 tests passed, 71 skipped |
| `bun run typecheck` | 0; all workspaces and config |
| `bun run knip` | 0 |
| `bun run build:www` | 0; web and manage production bundles |
| `git diff --check` | 0 |

These cover the commands in CI's `test-unit` and `typecheck` jobs. Existing
conditional test skips remained in effect, including Postgres suites without
configured test databases. The web build reported a non-failing chunk-size warning.
Docker image builds and Apple platform checks were not run: Docker, Swift, and
Xcode are unavailable on this Linux box. No production rollout was attempted.
