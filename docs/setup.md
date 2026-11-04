# Set up a Mac

## One-time work on the target

Create the administrator shown in `homelab.json` during Setup Assistant. Enable
**System Settings → General → Sharing → Remote Login** for that administrator.
Keep the Mac powered and reachable. Your personal laptop does not need Remote Login.

## Use the wizard

Install the public CLI from the Homebrew tap, then run `homelab`:

```sh
brew install 0x63616c/tap/homelab
homelab
```

For this repository enter `0x63616c/homelab` when asked to attach configuration.
GitHub CLI must be signed in with access to this private repository. Local
1Password integration is optional; the wizard can also accept hidden manual input.

| Stage | What happens |
| --- | --- |
| Connect | SSH trust, agent public-key selection if needed, read-only host checks |
| Prepare | Reuse/create age identities, confirm backup, create scoped enrollment key, encrypt secrets |
| Review & set up | Review exact commit and changes, then explicitly approve transfer and target Nix setup |

The wizard supplies the installer and remembers repository, host binding and
private credential paths. Do not install Nix on your personal laptop.

## Review before activation

Preparation produces a review directory with ciphertext and public recipients.
Commit only those reviewed files. Keep adjacent private keys, OAuth credentials
and plaintext tokens outside Git. Add the host's administrator SSH public key,
verify UID and service assignments in `homelab.json`, and enable activation only
in a reviewed change. Nix imports these same values and checks they agree.

The reusable Tailscale OAuth item stays in the operator's 1Password vault.
Only the generated single-use enrollment key is encrypted for the target.
An uncertain issuance result must be inspected before retrying; the wizard does
not blindly create another key. Expired or consumed keys need deliberate rotation.

## Add another host

1. Add its entry to `homelab.json`, initially disabled, and its `hosts/<name>.nix`.
2. Add the Darwin configuration in `flake.nix` and review account/UID assumptions.
3. Add its connection in the CLI and follow the same three stages.
4. After approved bootstrap, verify Tailscale, reboot/startup and service health.

For key backup and rotation see [secrets](secrets.md). Never wipe the existing
mini until replacement services and recovery have been verified and erasure is
explicitly approved.

## Repeatable testing

The public CLI runs synthetic adapter and terminal journeys on disposable macOS
CI, without your vault or hosts. Full install/reboot rehearsals need a disposable
Mac VM or a separately approved test Mac; that harness is not yet implemented.
See the public [testing guide](https://github.com/0x63616c/homelab-cli/blob/main/docs/testing.md).
