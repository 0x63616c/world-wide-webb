# Homelab operator client

One Rust package provides the operator menu (`homelab`) and local host operations
(`homelab-host`). Nix builds both; launchd directly invokes the AC power and
Tailscale operations, and the updater uses its typed service health gate. Bootstrap uses the same package for isolated secret
verification and atomic host-key installation. Tests use fixture executables
and temporary directories; they never change host settings.
Run `cargo test --manifest-path client/Cargo.toml --locked` for these tests and
`cargo clippy --manifest-path client/Cargo.toml --locked --all-targets -- -D warnings`
for static checks. The operator client does not require Python.

The operator command `homelab` provides the menu, read-only SSH inspection and
an explicitly approved setup wizard. Opening the menu does not connect to a host.
Restore, runner registration and routine management actions remain unfinished.

Install on your personal Apple-silicon Mac through the existing tap:

```sh
brew install 0x63616c/tap/homelab
homelab
```

The formula builds only the operator CLI from a pinned private-source commit.
It needs access to this repository through your existing GitHub authentication;
see the [tap's installation and authentication guide](https://github.com/0x63616c/homebrew-tap#homelab).
It does not install Nix, activate a host or start a background service. Opening
the menu does not connect until you choose an operation.

On an existing Nix-equipped Apple-silicon operator machine, run
`nix run .#homelab` from the reviewed repository. Rust development can use
`cargo run --manifest-path client/Cargo.toml --bin homelab`.
These are alternatives to Homebrew, not additional setup requirements.

To install only the operator CLI on your personal Mac from a reviewed checkout,
with Rust/Cargo and Apple's Command Line Tools already available, run:

```sh
cargo install --path client --locked --bin homelab
homelab
```

Run the installation command from the repository root. Cargo installs into
`~/.cargo/bin`, which must be on your PATH. This does not install Nix, configure
this Mac as a homelab host, or connect to another machine. No installation on
the target Mac is needed to open the operator menu.

On first run, press **n** to add a connection profile in the menu: enter its
name, SSH address/alias and administrator login, then select Save. This creates
only a private local file; it does not connect or configure the target. Escape
cancels the form. Failed saves keep your entered values for correction and retry.
Select a host with **↑ / ↓** and press **Enter** for guided connection and setup.
Press **i** for a separate read-only inspection; **q** quits when idle.

**s** is also a shortcut for guided setup. Each screen shows a short
status and a selected next action; use the arrow keys to choose and **Enter** to
continue. An unknown host gets a separate trust review before its identity is
remembered on your personal Mac. This skips independent fingerprint comparison, so use the address
from the target's local setup on your trusted network. Changed saved identities
are still rejected; the client never deletes them or disables host-key checking.

Connection failures distinguish an untrusted or changed identity, rejected keys,
an unreachable host and a hostname that could not be resolved. Only an
authentication rejection makes public-key installation the primary next action;
ambiguous errors do not imply a missing key. Choose **1Password SSH agent** to
list its public keys, select a name/fingerprint with **↑ / ↓**, then review it.
Open 1Password and enable its SSH agent on your personal Mac first. The picker
uses the local agent protocol, not the `op` CLI or a vault API. An existing public
`.pub` file is available as an alternative. The system SSH client
handles the target account's password in a normal terminal. Only the public key
is copied; existing authorized keys are preserved. A fresh key-authenticated
connection and read-only inspection verify access afterward. No password is
read or saved by the client, and no local SSH configuration is rewritten. If
interactive SSH fails, its message stays visible until you return to the menu.

An approved agent selection saves only the canonical public key and local socket
path in your private connection profile. Later checks, inspection, file transfer,
bootstrap and reconnect use that same key. Your private key stays in the agent;
1Password may ask you to approve authentication. No agent is forwarded to the
target and no password-manager software is installed there.

Selected-agent profiles connect directly to the saved hostname/IP on port 22.
They ignore custom SSH aliases, proxy settings and extra identity files so an
unrelated key cannot be offered before the selected one. Use the target's real
LAN or Tailscale address. Profiles without a selected agent identity retain
their existing SSH configuration. See 1Password's
[public-key selection guidance](https://www.1password.dev/ssh/agent/advanced).

Screens share header spacing and a two-line footer: the primary Enter action,
then navigation/back hints. Headings and selections use colour, with text labels retained for terminals
without colour. Set `NO_COLOR=1` to disable styling. Use `homelab --version` to
check the installed version; update through `brew update` and
`brew upgrade homelab`.

You can finish after access verification without any bootstrap inputs. Trust and
public-key changes remain in place if you stop; the wizard reports this. To
continue, it asks for the configuration host, reviewed commit, extracted CI
artifact directory, and paths to this host's age key and repository read-token
files. Enter paths, never secret values. The connection nickname and
configuration host are separate choices.

Preparation checks the artifact checksums and evaluated readiness plan, then
inspects SSH. It makes no target changes. Review the complete plan and type the
configuration host to approve transfer and activation. The wizard leaves raw
terminal mode while SSH and sudo handle administrator authentication; it never
stores that password. Escape cancels before approval and removes local working
copies. Your original files are retained.

A successful result confirms activation, staging cleanup and reconnect through
the selected SSH route. It does not prove a new Tailscale route, headless reboot,
service health or migration. A disconnected operation remains uncertain and
shows its private staging location for inspection; it never retries activation
blindly. Explicit resume still obeys the target journal's safety checks.
Both current host definitions are unready, so their current artifacts block
setup before transferring anything. No deployment is authorized by this PR.

`homelab setup --host NAME` opens the same interactive wizard directly. It needs
a terminal; it is not an unattended deployment interface. The public tap contains
only the formula; the source repository remains private.

The menu uses `~/.config/homelab/inventory.json` (or the file selected with
`--inventory`), stored mode 0600 in an owner-only directory. This file is separate
from the generic distributable client. Its format, for automation, is:

```json
{"schema": 1, "hosts": [{"name": "example-host", "address": "example-host", "user": "operator"}]}
```

Only named hosts, DNS/IPv4/SSH aliases and login names are accepted. IPv6 literal
addresses and custom ports are not implemented. The menu can add profiles;
a guided private-repository import is deferred. Existing malformed or
symlinked inventory is not silently replaced.

Ordinary inspection requires working key-based SSH and a previously trusted host key.
It uses strict host-key checking, no agent forwarding and no port forwarding.
It never accepts unknown host fingerprints; first-use trust is an explicit setup
choice only. The client reads
macOS version, architecture, login identity and free root-filesystem space only;
successful inspection is not proof of deployment or application readiness.

The noninteractive equivalent is `homelab inspect --host example-host --json`.
Exit 0 means the inspection succeeded on Apple silicon; exit 1 is blocked or
failed; exit 2 is invalid usage. Machine-readable output includes an error code
and next action. Normal operation opens the menu without requiring these options.
