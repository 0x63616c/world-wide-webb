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
  staging contents have been moved to their product/tooling/site locations. No tracked `imports/` paths remain.

## Work remaining

- Finish target layout and product command/release adapters. Air Miles and 27 Matt Pocock skills imported; RDesign is Tendr-local.
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

## Local evidence so far

- Selective CI: 9 tests pass, including real Git rename/deletion inputs, product isolation,
  docs/tooling behavior and CLI verification without host activation. Not connected to live delivery yet.
- Tendr: 50 core tests, mocked release checks and private-site retention/publication tests pass.
- Air Miles: 8 core/import/enrichment tests pass. Its small dynamic-color helper is app-local.
- Non-squashed history ancestry includes apps main and Air Miles branch `9bf0c8a`.
  Branch Tendr changes were already integrated/superseded by main (#58/#64/#65/#66);
  retained main's native rail/export/control fixes rather than restoring obsolete sidebar behavior.
- Original untracked Tendr requirements document copied into candidate; source left unchanged.
- First local implementation commit passed encryption/privacy/secret/format hooks.

- Xcode 27.2: regenerated Tendr/Air Miles projects and built both for generic iOS
  Simulator successfully with signing disabled. This proves build compatibility locally,
  not unattended VM posture capture or signed distribution.
