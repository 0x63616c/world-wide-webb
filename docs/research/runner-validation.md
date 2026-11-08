# Runner validation

Status: in progress, 2026-11-07. The MacBook configuration stages the managed service with job admission disabled.

## Passed

- Scoped GitHub App token issuance for world-wide-webb, JIT registration with runner group 1, and exact registration deletion.
- Local state-machine/API/adapter suites: 118 tests and strict Clippy. The two native-VM tests are explicitly ignored by default.
- Target Nix package build, portable guest-library install check, and enabled MacBook host-generation build without activation. The guest helper links only system libraries. Tart 2.41.1, Softnet 0.25.0 and runner SDK 2.338.2 are pinned.
- Real system LaunchDaemon starts the test executable as `_runner` UID 451. Dedicated login keychain creation, unlock and exact native getter verification pass.
- Protected tool/helper preflight, inventory and APFS clone of the cached digest-pinned stock macOS image pass under that service account.

## Real VM lifecycle: passed

The fresh-clone lifecycle passed as UID 451 under a system LaunchDaemon: boot, public guest helper Ready, stop, delete, confirmed absence and clone-lease cleanup. [Durable evidence](evidence/runner-vm-lifecycle.json) records the image, tools, identity and each completed stage. No GitHub credentials or job were used. This proves this boot's service context; the evidence explicitly records that a host GUI session was present.

The same lifecycle subsequently passed with the actual pinned Xcode image in 31 seconds. Its [separate evidence](evidence/xcode-runner-vm-lifecycle.json) also proves the native Tart operation lease was held during startup and after guest readiness, then released after stop before deletion. The cached image left approximately 171 GiB free; the host configuration uses a 140 GiB admission reserve and 80 GiB emergency floor. Production admission remains disabled.

The real [GitHub success job](evidence/github-runner-success.json) passed its arm64, non-root and Xcode checks. The [cancellation job](evidence/github-runner-cancellation.json) completed cancellation and cleanup. Both exact VM directories and GitHub runner registrations were confirmed absent afterward.

[Network probes](evidence/runner-network-probes.json) proved public GitHub HTTPS access, blocked LAN router/physical-host/tailnet DNS access with positive host controls, and blocked inbound guest SSH with a positive guest loopback control. Peer VM and IPv6 isolation are not established by these endpoint probes.

The [complete ordinary Apple CI run](evidence/apple-ci-success.json) passed every workflow job. Its Apple job completed in 442 seconds, including Rust setup, Swift/Rust integration, the iPad build/tests and iPhone policy tests. Workflow routing remains on the application PR until rollout is verified.

## Resolved startup failure

The cloned VM's Tart process exits during boot with `VZErrorDomain Code=1`. Timestamp-matched Virtualization process logs show `DiskImages2: Cannot acquire exclusive lock, errno 35`, immediately followed by device initialization failure. No process held the exact disk when checked after exit; no Tart/Virtualization/Softnet processes remained at that later observation. This does not identify which descriptor or image caused the conflict during startup.

The earlier failure's identity/evidence were archived privately before retry. A separate boot-only probe reused the stopped VM, captured private bounded pre-JIT stderr, reached actual guest-helper readiness and exited cleanly after an explicit stop. That old clone was then deleted before the successful fresh lifecycle test.

Live `lsof` during another boot caught service-owned `diskutil` and DiskImages processes reading that exact disk concurrently with the Virtualization process. Pinned Tart's [List implementation](https://github.com/openai/tart/blob/2.41.1/Sources/tart/Commands/List.swift) calculates disk capacity before reporting VM state, even in quiet mode. Removing startup inventory polling allowed both the recorded clone and a fresh clone to boot successfully. Production Starting observation now uses only positive guest-agent RPC evidence, retains Unknown after failed probes, and avoids List/Get. Regression tests cover recovery and the inventory race.

The probe uses a system LaunchDaemon with `SessionCreate=true`. A human GUI session is currently present on the host; this does not establish cold-boot-before-login operation.

## Findings fixed

1. macOS had created the service's Library and Keychains directories as 0755/0711. Provisioning now tightens only descriptor-verified service-owned directories to 0700.
2. Apple's `security login-keychain -s` implementation always fails despite advertising the setter. Creating the standard login keychain already made the native getter identify it. Preparation now verifies that getter's canonical path rather than invoking the disabled setter. [Apple implementation](https://github.com/apple-oss-distributions/Security/blob/main/SecurityTool/macOS/keychain_list.c).
3. Journal ownership could briefly outlive its owner through an incidental forked descriptor. A deterministic duplicated-descriptor regression failed before explicit owner unlock and passed afterward. Operation-lease probes similarly release only their own temporary locks; native clone/run owner leases deliberately remain inherited by their intended child.
4. The plugged-in MacBook repeatedly entered maintenance sleep/dark wake despite idle sleep being disabled. An AC-only native `caffeinate -s` assertion stopped further observed sleep cycles; the Xcode download completed and encrypted Tailscale ping succeeded. The original one-hour test assertion expired and cycling resumed. The live test daemon now holds the AC-only assertion until unloaded; the equivalent declaration is scoped to the MacBook.
5. A physical restart returned LAN SSH at the login screen without user login, but the temporary raw-ProgramArguments daemon attempted to execute before the Nix volume mounted and received EX_CONFIG. The service now uses nix-darwin's standard command abstraction, which waits for `/nix/store` before exec. The old installed generation also restored the rejected resolver symlink at boot. The next reboot must exercise the actual managed generation containing both fixes, with admission disabled.

## Controller interruption: regression fixed and repeated

Ordinary Apple CI reached checkout, Xcode selection, XcodeGen installation, caching and Swift formatting. Killing only the controller under launchd also terminated its Tart descendant; the replacement controller correctly retained the attempt, deleted the stopped VM and waited for GitHub's busy registration to clear. Cancelling/force-cancelling the interrupted workflow eventually allowed exact registration cleanup and returned the slot to idle. This was an interrupted build, not a successful recovery of its execution.

The launchd declaration now sets `AbandonProcessGroup=true`, so launchd does not kill Tart merely because its parent controller exits. A generated-plist check covers that setting. The [repeat test](evidence/controller-restart.json) recovered the same Running VM with a new controller PID and a successful guest RPC. The job continued through Swift package tests, then failed separately because the image lacked Cargo. The repository workflow now installs its pinned Rust toolchain explicitly; the next CI run must verify that correction.

The update hold refused immediate drain while the job was busy, remained active, and acknowledged idle after cleanup. The [binary replacement test](evidence/controller-update.json) replaced the controller while that hold remained active, released it afterward and admitted the next real job. The full enabled host generation also built without activation. Host reboot necessarily interrupts VMs; it must reconcile and clean rather than claim to resume a build.

The subsequent ordinary CI run passed Rust installation, Swift package tests and Swift/Rust integration. XcodeGen then failed because the guest's minimal environment omitted `USER`; its upstream generator explicitly requires that variable. The helper now sets `USER=admin` and `LOGNAME=admin`, matching the validated image account, and its wrapper regression tests those values. The complete rerun passed the iPad build and both simulator checks.

New boot intents persist operation-lease version 1 before spawning. An inherited fd0 keeps the exact attempt leased through parent loss. Recovery waits for quiescence before inventory/deletion; held or uncertain leases retain the slot. Actual subprocess crash tests cover this contract. Unproven legacy version-0 startup journals remain blocked rather than assuming their children are gone.

## Still required before enabling ordinary Apple CI

- Cold-boot-before-login operation; the current lifecycle passed with a host GUI session present.
- Peer/IPv6 policy coverage beyond the recorded endpoint probes.
- Unattended reboot reconciliation, final independent review and declarative rollout.
- Merge application CI routing without triggering the existing Mac mini deployment path; deployment and TestFlight routing stay unchanged.

Runtime probe logs and evidence stay private on the target. Passwords, App keys, JIT payloads and tokens are never part of this document.
