# Disposable macOS fixture

This template starts unready, without administrator keys or SOPS ciphertext.
The full enrollment rehearsal must add those through its real enrollment PR.
It exercises real bootstrap, Nix activation, decryption,
reboot, enrollment receipts and Comin reconciliation. Tailscale status and its
operator-side route are synthetic: no real vault, tailnet or production services
are involved. Never activate it on physical hardware.

## Prepare a coherent synthetic repository

Use a dedicated disposable GitHub repository whose **main branch** is both the
bootstrap source and Comin source. A fixture branch in the CLI repository is not
suitable: Comin would subsequently deploy that repository's unrelated main.
The operator publishes this repository; the harness never creates or pushes it.

1. Set `fixture.json.repository` to the dedicated owner/repository. The placeholder
   is mandatory to replace. `helperRevision` pins the published public helper
   candidate independently; update it only to the exact reviewed candidate SHA.
2. Generate a disposable Ed25519 administrator key outside the checkout using
   `ssh-keygen -t ed25519 -N '' -f STATE/id_ed25519`. Install it only in the guest
   for initial access. Keep private fixture state owner-only and outside Git.
3. Publish the unready baseline. The full wizard rehearsal supplies a synthetic
   issuer whose only key is `tskey-auth-synthetic-vm-only`. Real age/SOPS encrypts
   the production field `tailscale-auth-key` as `secrets/vm-test.sops.yaml`.
   The wizard's PR adds the administrator key and marks the host ready.
4. Merge that PR as enrollment commit A. Use the real target reservation,
   target-generated deploy identity and bootstrap operations. Register only that
   target public key as a read-only deploy key on this disposable repository.
   For completion-only tests, prepare the same ready manifest and encrypted
   payload before invoking real bootstrap. Bootstrap must create the genuine
   activation hold and receipts. **Do not seed
   or fabricate `/var/db/homelab-setup` or `/var/lib/homelab/hold`.**
5. After A activates while held, publish a harmless commit B to the same main.
   Keep its administrator, helper, synthetic status, and service assignments
   unchanged. Confirm Comin has not activated B before completion releases A.

The lockfile includes only public Nix inputs. Comin is pinned to
`004a55ced41d72340373ebc6774e29a417512638`; the root launchd job uses the real
`homelab-host run-updater` enrollment gate. The fixture never enables a real
Tailscale daemon. Its Rust `tailscale` executable supports only the exact status
request and reports `100.64.0.1`, `vm-test.synthetic.invalid`, and `tag:vm-test`.
The Rust health operation checks actual VirtualMac hardware, decrypted marker
content and a boot-daemon marker matching the current boot.

## Current harness coverage

Build `cargo test --test vm_e2e --no-run` and run the resulting binary **on the
named physical VM host** with `--complete /absolute/private/fixture.json`.
That harness fixture file is separate from this repository's `fixture.json`;
retain its physical/guest names, IP, pinned SSH key, nonce, exact enrollment
revision A and private paths. It must describe the already activated guest.

The completion operation performs real verification, requests the guest reboot,
verifies it again, releases the update hold, and waits for actual Comin
reconciliation. The harness then repeats completion and checks that boot UUID
has not changed again, plus the reconciled revision and boot daemon evidence.
`vm-tailnet` maps only synthetic `100.64.0.1` to the same pinned guest SSH route.
This does not prove real Tailscale routing, ACLs or OAuth enrollment. Provider
contracts are tested separately; a complete provider-to-PR-to-VM journey remains
separate work. The old `--run` manual-token path is intentionally unavailable.

These template changes have static checks only until evaluated and exercised in
the disposable VM. Missing ciphertext and placeholders deliberately block use.

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
fixture. The earlier bootstrap-only fixture passed activation and reboot on
November 4, 2026; that evidence does not validate this Comin completion version.
See [recorded evidence](../../../docs/testing.md).
