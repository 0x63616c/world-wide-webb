# CLI separation

## Outcome

One public tool, one private configuration repository. Install the tool, attach
this repository once, choose a Mac, and follow Connect → Prepare → Review & set up.
The operator laptop needs neither Nix nor a compiler when using release binaries.

## Ownership

| Location | Contains |
| --- | --- |
| Public `homelab-cli` | Rust UI, SSH, credential adapters, portable bootstrap helper, synthetic tests |
| Private `homelab` | `homelab.json`, Nix, services, encrypted secrets, private health/restore operations |
| Local 1Password | OAuth credentials and recovery backups; never installed on targets |

`homelab.json` is data shared by the CLI and Nix. It declares host review facts
once. The target checks the evaluated Nix facts against the approved manifest
before activation. Public tool release versions and private configuration commits
are separate identities. Only exact private commits are applied.

## Reviewed decisions

Architecture review identified the old installer/config revision coupling.
Security review required a fresh public history, synthetic fixtures, explicit
repository binding, no secret argv/logs, and no automatic retry of ambiguous key
creation. DX review removed manual commit/artifact inputs and repeated host choice.

The public repository gets an allowlisted working tree, never private history.
Private service checks stay private. Existing SSH inventory and identities are
preserved; a saved repository binding prevents accidental cross-repository reuse.

## Delivery

1. Extract generic tool and helper into fresh history; replace private constants
   with validated manifest input and a small credential-source interface.
2. Test SSH, UI, secret handling, bootstrap guards and interrupted operations on
   disposable macOS CI with synthetic credentials.
3. Publish reviewed native release binaries; update the Homebrew tap.
4. Pin the public source in private Nix and move private service operations into
   `host/`. Keep activation disabled.

## Acceptance and limits

The client does not install Nix. Opening it never deploys. The final review names
repository, commit, host and services; activation needs explicit confirmation.
Secrets remain outside public artifacts. Repository mutation and real-secret
publication are not silently automated.

PTY tests can drive UI without a human. Real install/reboot/recovery testing needs
a disposable Mac VM or separately approved test Mac. Public CI tests are not proof
of a production migration. No Mac is wiped or deployed by this extraction.
