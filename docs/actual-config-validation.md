# Actual configuration validation

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

- Current CLI and actual modules through enrollment, activation and reboot.
- Controlled failed-build recovery, including the user's already-repaired revision.
- Git reconciliation and completed replay.
- One-password journey, including independent post-reboot reachability checks.

The actual-module fixture's setup plan evaluates successfully with only `vm-test`.
That is fixture wiring evidence, not activation or end-to-end evidence.
