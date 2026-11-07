# Actual configuration validation

## Current continuation evidence

The actual-module fixture at `6f78c497a363d90ec2d3482c992f79c928ec7c38`
built and activated with public helper `c949c7201cc1f39bfa51f0e7534ede5a57d65919`.
The preserved VM then passed production completion, reboot, post-reboot service
checks, Git reconciliation and completion replay without a second reboot.
Evidence: operator fixture `actual-config-operator-3/completion-recovery-evidence.json`.
The provider and Tailscale transport were synthetic. The test driver was
interrupted at the installation acknowledgement, so uninterrupted wizard setup
and real password-required authentication are not claimed.

The successor descriptor preserves the original enrollment and first repair;
it changes no manifest, installer, flake lock, recipients or host ciphertext.

## Reproduced failure — 7 November 2026

Disposable VM: `homelab-actual-config-1`, cloned from `homelab-ready-clean` on
the authorized MacBook virtualization host. Model: `VirtualMac2,1`.

An unchanged Git checkout of `983625622774682ade4f3552c2f8168dc091a2bc` failed
when building `darwinConfigurations.homelab-macbook.system`:

- Derivation: `/nix/store/16ajfysn8zca0dkp388dm2i8d7dbc0sf-darwin-system-26.11.ff0e21a.drv`
- Generated activation script, line 48: `if [ 'yes' != yes ]; then`
- ShellCheck SC2050: constant expression.

The fix generates the missing-key failure only when no authorized keys exist,
using `lib.optionalString`. It preserves the activation guard without a constant
shell conditional.

## Exact candidate build — passed

Unmodified candidate: `629150a6a2b575f0e9dd7c75ddca71bcaa66f91e`.
Command in the disposable VM:

```sh
nix build --no-update-lock-file --print-build-logs \
  .#darwinConfigurations.homelab-macbook.system --out-link ../actual-system
```

Output: `/nix/store/wbwmr3l9afqa9nbcx43lq17iskisjl8s-darwin-system-26.11.ff0e21a`.
Derivation: `/nix/store/aczqsvx6z8hnwgdrc902n6psx8gbdvbw-darwin-system-26.11.ff0e21a.drv`.

The original failure and successful candidate logs remain in the guest at
`/Users/admin/actual-config-build.log` and `/Users/admin/actual-build-fix.log`.
No production configuration was activated, in the guest or on a physical Mac.

## Still required

The actual-module enrollment reached activation at fixture revision
`249feb7ee6901a66be6d48f2e3d87ed84832d087`, then correctly refused a numeric
account collision. The installed Nix environment owns GID 350 (`nixbld`) and
UID 351 (`_nixbld1`). The candidate moves homelab service accounts to 450/451,
which were verified vacant in this guest, while retaining collision checks.
Diagnostic fixture revision `28fc482` built and activated successfully with IDs
450/451. The guest rebooted from boot timestamp `1794080249` to `1794082636`,
then accepted the Git-configured SSH key. Its boot sentinel recorded that same
new timestamp after validating the decrypted synthetic secret. Active output:
`/nix/store/safd8php3zwdbkkryv10ghkh86vhag5y-darwin-system-26.11.ff0e21a`.

This diagnostic activation bypassed the failed wizard attempt deliberately;
it is not evidence of wizard recovery or of the new password implementation.
The failed attempt's journals remain intact for inspection.

Guest evidence is preserved in `/Users/admin/activation-diagnostic.log` and
the bootstrap journal at phase `Activating`. This diagnostic activation was
only attempted in the disposable VM; no physical node was activated.

- Current CLI and actual modules through enrollment, activation and reboot.
- Controlled failed-build recovery, including the user's already-repaired revision.
- Git reconciliation and completed replay.
- One-password journey, including independent post-reboot reachability checks.

The actual-module fixture's setup plan evaluates successfully with only `vm-test`.
That is fixture wiring evidence, not activation or end-to-end evidence.
