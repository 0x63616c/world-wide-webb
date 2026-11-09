# Setup diagnostic audit

Scope: operator-side provider and SSH/Git transport failures. No live provider,
credential, host or vault inspection was used. Bootstrap/fetch diagnostics are
being handled separately in `bootstrap.rs` and `bootstrap_diagnostics.rs`.

## Confirmed loss points

- `secret_store.rs`, `admin_credential.rs`, `tailscale_oauth.rs`: failed `op`
  commands collapse execution errors/nonzero status into `Access` or
  `ItemUnavailable`; administrator handling then zeroizes stderr. Preserve safe
  authorization-denied/cancelled/locked/not-found causes and exit status before
  zeroization. Never persist item JSON, template/stdin or stdout.
- `config.rs`, `deploy_keys.rs`, `configuration_pr.rs`: GitHub CLI failures lose
  subprocess causes. Deploy-key creation currently examines HTTP status only to
  distinguish definite rejection from uncertain creation. Preserve that existing
  receipt/idempotency distinction. A missing optional GitHub resource is an
  expected absence, not a failed mutation.
- `first_access.rs`, `inspect.rs`, `git_ssh.rs`: SSH/Git stderr is captured then
  discarded or reduced to broad errors. Public authentication/network/host-trust
  causes need persisted diagnostic evidence. Untrusted remote banners are not
  safe to record verbatim.
- `remote_setup.rs`: SCP uses `run_silent`, discarding both streams before failure
  is known. Staging/read-only SSH failures similarly lose transport details.
  Primary transfer failures and cleanup failures must have separate operation
  labels; cleanup failure must not replace the original failed operation.
- `tailscale_oauth.rs`: HTTP token exchange/key creation/revocation discard
  transport and HTTP status causes. Never log response bodies or OAuth/key
  material, and never automatically repeat uncertain key creation.

## Diagnostic requirements

Use a private bounded operator journal available before enrollment starts.
Record a fixed operation label, execution/exit status and safely redacted cause;
exclude command arguments, environment, stdin, all provider stdout and raw
provider responses. Credential-provider errors require strict classification,
since stderr itself can echo JSON or credentials. Unknown/suppressed details and
journal-write failures must be explicit rather than silently presented as a
complete diagnostic record. Preserve the existing public typed error and safe
recovery instructions, with a short diagnostic-location pointer.

## Remaining boundaries

Missing optional local state, absent optional GitHub policy resources and
best-effort discovery probes are not automatically primary failures. Their
fallbacks need to remain distinguishable from rejected or uncertain mutations.
Full state/serialization error detail must not expose secret-bearing payloads.


## Monorepo integration verification

The imported recovery snapshot is preserved in the original checkout. During independent
review, unrestricted non-op stderr recording was rejected: remote banners, spaced/multiline
credential fields and truncated key bodies cannot be made safe by a token blacklist.
Diagnostics now persist fixed failure classes and typed HTTP status/I/O-kind/OS-error metadata;
unknown command details are omitted. Operation/phase/time/exit metadata remains available.
A journal-write failure emits one notice, and setup failures expose the valid journal path.

Identity selection after connection also refreshes the authentication scope through a fresh
selected-key connection pinned to the original SSH peer. Only the identity may change; a
changed administrator, target or observed host key is rejected before credential preparation.
Informational screens keep one Esc Back action while Enter remains a nonapproving return.
These are local synthetic/unit/terminal checks; live host/account recovery remains separate.
