# Full enrollment wizard rehearsal

This is an opt-in integration harness, not a production setup entry point. Normal `cargo test
--test vm_enrollment` performs local guard regressions and skips all network/VM work. Build with
`cargo test --test vm_enrollment --no-run`, then run that executable on the **operator client**:

```
vm_enrollment --run /absolute/private/enrollment-fixture.json
```

It calls the production wizard with synthetic credential-provider adapters and real provisioning
transactions, age/SOPS, private GitHub repository operations, bootstrap, reboot and Comin
completion. It does not query a real vault or enroll in a real tailnet. The selected guest key
is supplied by the test transport; 1Password key discovery/approval is outside this test.
Existing client agent authentication is used only to reach the approved virtualization host.

## Prepare a fresh, coherent fixture

- Use a **new** disposable guest and an empty operator state directory. Do not use the active
  bootstrap attempt or manufacture reservation/activation receipts.
- The jump is explicitly supplied, for example `admin@vm-host.local`. Pin its existing trusted
  host key in a separate private file containing one unhashed host entry. The temporary SSH
  config uses strict checking and the explicitly supplied agent socket; it changes no personal
  SSH config and forwards no agent into either machine.
- Keep the physical VM host awake on AC using temporary `caffeinate -is -w PID` bound to the
  running Tart VM process. `-i` alone did not prevent observed Maintenance Sleep/DarkWake. No
  permanent power settings are needed.
- Prepare Remote Login, the disposable guest SSH key, `admin` UID501, hostname `vm-test`, and
  the existing nonce marker `/var/tmp/homelab-vm-e2e.json`. Retain the VirtualMac, hostname,
  nonce and pinned guest host-key checks. Guest-only sudo must permit both `sudo -n true` and
  `sudo -n -v`.
- Use a dedicated **private** repository named `homelab-vm-*`. Its main must be the actual
  fixture Nix source. Start with `vm-test` unready, no authorised keys, no host ciphertext and
  `tailscale: {"tag":"tag:vm-
  test","oauth":{"vault":"aaaaaaaaaaaaaaaaaaaaaaaaaa","item":"dddddddddddddddddddddddddd"}}`.
  The fixture health and boot scripts must check the production SOPS field `tailscale-auth-key`
  against `tskey-auth-synthetic-vm-only`, not the obsolete `vm-rehearsal-marker` field.
- Use real client `gh` authentication already authorised for this fixture. The harness
  references its existing `GH_CONFIG_DIR`; it never copies that directory or its credentials to
  the VM host or guest. Every adapter API request is confined to the fixture repository. It
  registers the guest-generated read-only deploy key, opens an actual enrollment PR, and merges
  that PR using its exact head SHA. It never uses an admin merge override. Repository checks
  must permit this explicitly authorised synthetic merge; no other writer should move main.
- Supply standalone age-keygen, SOPS and the matching reviewed homelab-host helper. They are
  copied into the private operator state beside the harness executable. The fixture's Nix helper
  pin must match the reviewed implementation.

The private fixture JSON extends the completion target description:

```json
{
  "operatorHostname": "EXACT_OPERATOR_HOSTNAME",
  "stateDirectory": "/absolute/new/private/operator-state",
  "gh": "/absolute/path/to/gh",
  "githubConfigDirectory": "/absolute/existing/client/gh-config",
  "ageKeygen": "/absolute/path/to/age-keygen",
  "sops": "/absolute/path/to/sops",
  "jumpHost": "vm-host.local",
  "jumpKnownHosts": "/absolute/private/jump-known-hosts",
  "jumpAgentSocket": "/absolute/existing/operator-agent.sock",
  "target": {
    "repository": "OWNER/homelab-vm-FIXTURE",
    "revision": "EXACT_40_CHARACTER_INITIAL_MAIN_SHA",
    "manifestPath": "/absolute/private/initial-homelab.json",
    "configurationHost": "vm-test",
    "guestIp": "192.168.64.2",
    "guestHostname": "vm-test",
    "physicalHostname": "EXACT_VM_HOST_HOSTNAME",
    "nonce": "EXACT_64_HEX_GUEST_NONCE",
    "sshPrivateKey": "/absolute/private/disposable-guest-key",
    "knownHosts": "/absolute/private/guest-known-hosts",
    "ageKey": "/unused-in-full-enrollment",
    "helperPath": "/absolute/path/to/reviewed/homelab-host"
  }
}
```

All fixture JSON, copied manifest and key files must be regular, owned by the operator, private
(0600) and bounded. `ageKey` is an unused compatibility field in the shared target descriptor:
this journey generates its real disposable age identities through the production provisioning
session.

## Evidence and failure behavior

The PTY approves only the defined setup review, waits for the wizard's real PR, checks its
repository/head/base and three-file scope, then merges that head. The wizard itself installs and
reboots. The harness verifies changed boot UUID, terminal restoration, current revision and
boot-daemon evidence, and exact equality between the locally encrypted ciphertext and the file
in the merged Git commit. Completion's production verifier requires real Comin reconciliation
before the wizard can report success. `evidence.json` and `merged-revision` are saved privately;
provider and Tailscale transport simulations are explicitly identified.

No raw terminal transcript or credential is written as evidence. Preserve the VM and private
state on any failure. The harness does not retry mutations, delete GitHub PRs/deploy keys or
resume an interrupted enrollment automatically. Use the separate `vm_e2e --complete` journey for
an already activated fixture when suitable. The harness must pass an actual disposable-VM run
before claiming full validation.

The harness reopens the completed wizard with the same operator state. It requires no second
credential issuance (the issuance marker is create-new), unchanged fixture deploy keys and pull
requests, and the same guest boot UUID. This replay uses the production saved-installation and
completion paths.
