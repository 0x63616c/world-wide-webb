# Monorepo migration progress

Execution authorized November 8, 2026. The accepted scope and acceptance criteria are in
[the migration plan](world-wide-webb-monorepo-2026-11-08.md).

## Current candidate

Local branch `codex/monorepo-consolidation`, created from WWW `242eb8f4a0c3dc1ca336c20682e610128f914ac9`.
Nothing published, no visibility or production changes. Original working copies remain untouched.

Non-squashed local history imports:

- Folding `ea966862c7e07e08bb7f046873b94d7c915977a3` into `apps/folding`.
- Callkeep `73bb6dde3dbc765756ff12f3751db5bfad9bc4de` into `apps/callkeep`.
- Apps `590d39abf0d483d232b3045d10446ef83895ae79` temporarily into `imports/apps`;
  this staging path must be eliminated before publication.

## Work remaining

- Finish target layout, product command/release adapters and independent Air Miles/skills integration.
- Verify selective CI and gate; connect actual product checks and release evidence.
- Implement and canary Apple delivery, private Homebrew artifacts and screenshot access.
- Refresh/import homelab and CLI only after their active source work lands; preserve setup state.
- Transfer scoped Cloudflare/home operations and verify state, login, data, backups and recovery.
- Complete documentation, templates and encrypted signing ownership.
- Independent final Astra review, grouped fixes, relevant checks and integrated verification.
- Make WWW private before pushing private history; publish, pass required checks, merge and verify delivery.
- Retire old authorities/archive eligible repos after replacement proofs. Preserve every exclusion.

## Dependencies and preservation

Homelab main advanced to `ae2b14e2df6575712802522a1d0ff1a01a0370a8` (Beszel merge).
Linux runners and CLI recovery still have active work. Main merges do not prove live activation.
Folding has uncommitted product/design changes; apps has Air Miles branch work and an untracked
Tendr requirements document. Do not silently discard or freeze these; refresh before handover.
