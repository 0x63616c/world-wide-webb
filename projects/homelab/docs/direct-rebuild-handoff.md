The route is **final verified service backups → you wipe and enroll the Mini → we restore directly onto it**. Home services will be unavailable during the rebuild. Personal files, local projects and custom settings are excluded as requested; Penpot is optional.

**Pre-wipe verification passed.** The final Docker checkpoint and normal backup are verified off the Mini; its containers and Docker engines are stopped. Services have not yet been restored onto a rebuilt Mini.

You then:

1. Erase the Mini yourself.
2. Create its first administrator with short name **admin**, UID **501**. Check locally with `id -u admin`.
3. Set the local hostname to **homelab-mac-mini** and enable **Remote Login** for admin. Keep it powered on the same home network.
4. At the Mini console, obtain its fresh SSH fingerprint with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`. Compare it with the operator connection; stop for review if saved trust conflicts.
5. On your operator Mac, open **`homelab`** (installed CLI verified: **0.4.1**), select **0x63616c/homelab → homelab-mac-mini**, and complete setup/reboot verification. GitHub, unlocked 1Password and standalone Tailscale must be available. The reviewed rebuilt-Mini configuration must be on `main`.

Your manually created 1Password administrator item is not automatically canonical; do not assume the CLI will overwrite it or adopt old SSH bindings.

After enrollment, we restore **Control Center SQLite + media; Hindsight dump + Codex home/provider state; HA configuration; Bambuddy app/studio data + Tailscale identity; tunnel credentials/routing**, then verify services and backups. Penpot data is restored only if retained.

Use the latest encrypted `docker-prewipe-20261108T152439Z.tar.gz.age` checkpoint for authoritative app data. Its Hindsight restore verified31 banks,6,495 memories and1,587 documents. The normal `20261108T150608Z` backup supplies logical fallback and service configuration.
