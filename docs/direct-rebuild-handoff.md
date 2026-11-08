The route is **final verified service backups → you wipe and enroll the Mini → we restore directly onto it**. Home services will be unavailable during the rebuild. Personal files, local projects and custom settings are excluded as requested; Penpot is optional.

Wait for our explicit **ready to erase** handoff confirming final off-Mini backups and independent recovery credentials. Services have not yet been restored onto a rebuilt Mini.

You then:

1. Erase the Mini yourself.
2. Create its first administrator with short name **calum**, UID **501**. Check locally with `id -u calum`.
3. Set the local hostname to **homelab-mac-mini** and enable **Remote Login** for calum. Keep it powered on the same home network.
4. At the Mini console, obtain its fresh SSH fingerprint with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`. Compare it with the operator connection; stop for review if saved trust conflicts.
5. On your operator Mac, open **`homelab`** (installed CLI verified: **0.4.1**), select **0x63616c/homelab → homelab-mac-mini**, and complete setup/reboot verification. GitHub, unlocked 1Password and standalone Tailscale must be available. The reviewed rebuilt-Mini configuration must be on `main`.

Your manually created 1Password administrator item is not automatically canonical; do not assume the CLI will overwrite it or adopt old SSH bindings.

After enrollment, we restore **Control Center SQLite + media; Hindsight dump + Codex home/provider state; HA configuration; Bambuddy app/studio data + Tailscale identity; tunnel credentials/routing**, then verify services and backups. Penpot data is restored only if retained.
