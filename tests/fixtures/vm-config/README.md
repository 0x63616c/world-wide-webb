# Disposable macOS fixture

This template needs disposable keys and ciphertext before use. It exercises the
real bootstrap installer, Nix build, host-key installation, SOPS decryption,
activation and launchd startup. It has no tailnet enrollment, updater, production
services or Homebrew management. Never use it on physical hardware.

## Prepare a synthetic fixture commit

Copy this directory into a new clean repository checkout for a **synthetic test
branch**. Keep all generated private files in a separate owner-only temporary
state directory, outside that checkout. The operator owns publishing this branch;
the test harness never publishes it automatically.

1. Generate a disposable Ed25519 key with `ssh-keygen -t ed25519 -N '' -f STATE/id_ed25519`,
   where `STATE` is the separate private temporary directory, never `~/.ssh`. Replace the `homelab.json` public-key placeholder with its `.pub`
   content. Retain the private key outside Git and use it only for this VM.
2. Generate a disposable age identity with `age-keygen -o PATH`. Extract its public
   recipient with `age-keygen -y PATH`. Encrypt the synthetic entry documented in
   `secrets/README.md` using SOPS and that explicit recipient; save only ciphertext
   as `secrets/vm-test.sops.yaml`. Use an isolated working directory and explicit
   SOPS configuration so operator defaults cannot leave the field unencrypted.
3. The harness supplies its own synthetic GitHub-token file. The
   fixture branch must be public, so Git does not need a real repository token.
   Do not supply production tokens, production age keys or any tailnet key.
4. Commit the generated public key and ciphertext with these templates. Keep
   `flake.lock` unchanged. The reviewed configuration revision is this commit;
   it is independent of the public helper revision pinned in `helper.nix`.

The included lockfile contains only the transitive public Nix inputs needed by
this fixture. The helper source is pinned independently to a published commit.
No private deployment configuration is included.

## Guest preparation and evidence

Use a disposable ARM64 macOS VM with user `admin`, UID 501, and Remote Login.
Set its hostname to `vm-test` before the harness starts. Install the disposable
SSH public key and seed `/var/tmp/homelab-vm-e2e.json` with the harness nonce and
hostname. The harness also checks `hw.model` starts with `VirtualMac`.

The guest administrator must pass both `sudo -n true` and `sudo -n -v`.
For this disposable VM only, validate a sudoers drop-in with `visudo` containing
`Defaults:admin verifypw=never`, alongside the fixture's NOPASSWD rule. Mixed
admin rules otherwise can allow commands but prompt during validation. Validate
the complete configuration and both commands; never apply this fixture policy
to the physical host or production Macs.

A vanilla image must first demonstrate the missing Command Line Tools error.
Install CLT inside that guest before the positive bootstrap run. A base image
with CLT preinstalled cannot establish that fresh-machine prerequisite behavior.

After activation the harness verifies:

- `/etc/homelab-vm-e2e.json` identifies `vm-test` and the exact fixture commit.
- `/var/lib/sops-nix/key.txt` is root-owned mode 0600 inside a mode-0700 directory.
- Launchd job `org.homelab.vm-e2e` exists. It decrypts the synthetic marker before
  writing the current `kern.boottime` to `/var/tmp/homelab-vm-e2e-boot`.
- After a **guest-only reboot**, the boot timestamp changes and all checks pass
  again. The job retries if SOPS initialization has not finished yet.

The fixture's pre-activation guard independently refuses non-VM hardware. Keep
the VM and test state for inspection on failure; do not reinterpret an interrupted
connection as proof that setup stopped. No physical host reboot is part of this
fixture. A prepared version passed guided activation and reboot on November 4,
2026; see [recorded evidence](../../../docs/testing.md).
