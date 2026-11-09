# Trusted operations capacity

Status: local migration candidate. No live operations canary, Tailnet policy acceptance or
production deployment handover is claimed. Normal build guests retain their existing isolation.

`[self-hosted, Linux, ARM64, homelab-operations]` uses the same pinned Linux image, UID,
public-egress Softnet policy and CPU/memory/disk accounting as `homelab-linux`. It does not
preload a Tailscale identity, SSH key, vault, registry credential or controller App key.

The controller creates this capacity only for an allowlisted main workflow/job after its named
normal-Linux source job succeeds at the same workflow SHA/run/attempt. It checks that evidence
again during job observation. Pull-request workflows and unknown paths do not authorize capacity.
The allowlist names Cloudflare apply and the operations canary. The local Cloudflare consumer
uses the named source/apply jobs and operations credentials; it remains disabled until proven.
Control Center image publication now updates the existing homelab release pin through normal
Git promotion, so `deploy-mini.yml` no longer authorizes operations capacity.

This admission check is not exclusive job affinity. GitHub may assign another matching job to
an authorized runner before controller revalidation. The label therefore must never itself grant
extra network access, mount a privileged socket, inject credentials or select a privileged image.
Workflow-scoped credentials are the actual capability boundary; keep ordinary PR/build workflows
free of these credentials. Adding a pre-provisioned capability would require a stronger execution
boundary before any untrusted job code can start.

## Staging probe

`Homelab operations canary` runs only on main after `HOMELAB_OPERATIONS_CANARY_ENABLED` is enabled.
Its source job requires successful exact-source main Homelab CI, including every named host check;
a full explicit main CI dispatch is accepted when an app-only push skipped those checks. The
canary's checkout, workflow SHA and checked CI source must match. This does not authorize a host apply.

Before enabling, prepare an OAuth client restricted to `tag:homelab-operations`, an SSH identity
scoped to the mini, and the independently verified mini host key. Store the client ID/secret and
private SSH key as `HOMELAB_OPS_TS_CLIENT_ID`, `HOMELAB_OPS_TS_CLIENT_SECRET` and
`HOMELAB_OPS_SSH_PRIVATE_KEY`; `HOMELAB_OPS_KNOWN_HOSTS` contains the public peer pin. Back up
required identities in the approved secret store. Inspect the actual Tailnet policy: allow the
required mini SSH endpoint and deny other home peers/services. Do not infer policy from a label.

The probe checks that the MacBook peer's SSH endpoint does not open, then uses pinned ordinary
SSH to the mini to write/read/delete only a temporary source-metadata file. A byte-matching reply
and completed cleanup are required. It never starts/stops a service or reads product data. A
negative connection probe alone does not prove the entire ACL; retain independent policy evidence
and confirm the negative-control peer is otherwise reachable before claiming isolation acceptance.
Temporary local SSH material is removed by the step trap; VM/registration and Tailnet identity
cleanup must also be observed during live acceptance. Rerun the whole canary workflow for a retry
so its source check is fresh in the current attempt; no application artifact is rebuilt.

Keep production release/apply flags off until this probe and provider policy pass. Use the
existing stateful operation locks, backups, source ordering and private Serve ownership for the
subsequent deployment adaptation. Do not restore the retired-user SSH deployment as a shortcut.

## Cloudflare consumer preparation

`Apply Cloudflare` now matches the controller's named source/apply admission pair. Its source
check runs on ordinary Linux and accepts only successful trusted-main CI; the apply job requests
operations capacity. It uses only the scoped operations OAuth/SSH identity and public host pin,
without decrypting the legacy application vault. Main-only execution, existing checked HCL,
state-owner encryption/locking, backup checks and positive apply confirmation remain enforced.
Temporary local key/pin files are removed on success and failure. Remote staging is validated
before use and must be removed before reporting success. The real shell is exercised with fake
SSH for success, missing confirmation, cleanup failure and an invalid returned staging path.

This is local preparation. The enable flag remains off. Actual Tailnet policy/transport canary,
state-owner and encrypted restore acceptance, and source ordering remain prerequisites to live
activation. The operations label itself does not grant any capability.
