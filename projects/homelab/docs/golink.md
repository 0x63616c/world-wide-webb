# Golink

Tailscale golink runs on the Mac mini as its own tailnet node, `go`. Open
`http://go/` while connected to Tailscale to create and manage short links.
MagicDNS must be enabled and accepted by the client. If the browser searches
instead of navigating, enter the full `http://go/` URL. The fully qualified
address is `http://go.tail8c014d.ts.net/`; golink redirects to HTTPS when the
tailnet enables certificates. Each user owns the links they create.

The optional [Golink Safari extension](../../golink-safari/README.md) turns complete
`go/repo` Google.com searches into tailnet navigations on Mac, iPhone and iPad.

## Deployment

`projects/homelab/services/golink/compose.yaml` pins the official upstream image by digest.
The normal reviewed-main → Homelab CI → `deploy/homelab` promotion → transactional
host updater owns deployment. Do not start a second copy of the same node.
No host ports, Tailscale Serve routes, public DNS or Cloudflare changes are needed:
golink uses embedded userspace Tailscale networking (tsnet).

The `_containers` reconciler projects only `services/golink/environment` from
host SOPS ciphertext into its private runtime directory. Enrollment uses a
single-use, non-ephemeral key for the existing `tag:homelab` assignment. Keep the
OAuth provisioning credential on the operator's laptop. After enrollment the
persistent tsnet identity handles reconnects; the consumed key cannot enroll
another node. Never put plaintext keys in Git or command arguments.

Before first host assignment, create the external `golink_data` volume in the
mini's existing services Docker runtime and set its root directory to UID/GID
65532. Use the host operation lock as `_containers`. This is a one-time creation,
not a reconciliation fallback: a missing volume after deployment must fail so
lost links or a missing identity cannot silently become a fresh installation.
Stage and verify the host's encrypted enrollment environment before assignment.

After normal host adoption, run `homelab-health` as `_containers` and open
`http://go/` from another tailnet device. The health gate requires a running
container and a successful HTTP request through MagicDNS, following HTTPS
redirects. Verify a saved short link redirects to its intended destination.

## Backups and recovery

The normal full-service backup includes `golink-data.tar.gz`, capturing all of
`/home/nonroot` while golink is stopped: SQLite `golink.db` and the tsnet identity
under `.config/tsnet-golink`. The recovery archive carries the Compose definition
and private enrollment environment; the image inventory records the exact image.
The existing publisher sends accepted sets to the private NAS with byte checks.
For a scoped capture, run the following as `_containers`:

```sh
homelab-operation -- homelab-backup-now --scope deployment --services golink --local-only
```

Check `NAS_VERIFIED` separately for off-host publication.

For recovery, stop the original golink before restoring its identity. Download
and verify the selected backup set with `projects/homelab/scripts/verify-backup.py`.
Validate/extract `golink-data.tar.gz` into fresh private staging with
`projects/homelab/scripts/restore-archive.py`, then import it into a fresh VM-local volume,
preserving UID/GID 65532 and the full directory tree. Never replace a populated
volume with empty storage or run the restored identity beside the original.
Restore the private environment through SOPS, reconcile with the retained image
pin and verify `go/` plus a known short link. Losing the entire identity requires
explicitly retiring the old tailnet node before re-enrollment as `go`.

Upstream: https://github.com/tailscale/golink
