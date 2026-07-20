# Plex Media Server

Plex runs as a workload in the `control-center` namespace on the homelab k3s
cluster (context `cc-homelab`). It serves the Synology media share to the
Apple TV. The spec lives in `infra/src/services.ts` (the `plex` workload +
the `plex-config` local-path claim); it deploys via the normal push-to-`main`
→ CI `pulumi up` path.

## Shape

- **Image**: `plexinc/pms-docker:1.43.2.10687-563d026ea` (public, multi-arch;
  arm64 manifest for the OrbStack node). No GHCR pull secret, no digest pin,
  same as the other third-party image (cloudflared).
- **Config volume**: `plex-config` local-path PVC (10Gi) mounted at `/config`.
  Plex's SQLite databases live here and **must not** go on NFS (SQLite over NFS
  corrupts).
- **Media volume**: the Synology NFS export `/volume1/Homelab`, subPath `media`,
  mounted **read-only** at `/data` — the same share the worker's media ingest uses.
- **Exposure**: a `LoadBalancer` Service on `32400`. OrbStack's
  `expose_services` republishes the port on the Mac host, so the Apple TV on
  `192.168.0.0/24` reaches Plex at **`http://192.168.0.147:32400`** (the Mac's
  en0 LAN IP). `ADVERTISE_IP` is set to that URL so Plex publishes a
  directly-reachable connection URI (not the OrbStack-internal pod IP).
  - If the Mac's LAN IP ever changes, update `ADVERTISE_IP` in
    `infra/src/services.ts` and re-deploy.

## Reachability check

From the Mac host or any LAN device:

```sh
curl -s http://192.168.0.147:32400/identity      # LAN
curl -s http://localhost:32400/identity          # on the Mac host
```

A healthy (even unclaimed) server returns `MediaContainer` XML with a
`machineIdentifier`. From the tailnet you can also hit
`http://homelab.tail8c014d.ts.net:32400/identity` **if** a host-level forward
for 32400 exists; the LAN URL above is the supported path for the Apple TV.

## One-time manual claim (REQUIRED)

The server deploys **unclaimed** — no `PLEX_CLAIM` token is baked in, because
plex.tv/claim tokens expire ~4 minutes after issue so none can be pre-stored.
Claim it once, either way:

### Option A — claim token (headless)

1. On any machine signed into the target Plex account, open
   <https://plex.tv/claim> and copy the `claim-…` token (valid 4 min).
2. Inject it and let the entrypoint claim, then remove it:
   ```sh
   kubectl --context cc-homelab -n control-center set env deploy/plex PLEX_CLAIM=claim-XXXXXXXX
   kubectl --context cc-homelab -n control-center rollout status deploy/plex
   # once claimed (verify in the web UI), clear it so it isn't reused:
   kubectl --context cc-homelab -n control-center set env deploy/plex PLEX_CLAIM-
   ```
   Note: this env override is imperative and will be reverted on the next
   `pulumi up`. That's fine — claim state persists in the `plex-config` PVC, so
   the server stays claimed regardless of the env var.

### Option B — browser on the LAN

1. From a device on `192.168.0.0/24`, open
   <http://192.168.0.147:32400/web>. An unclaimed server is reachable without
   auth only from the local network.
2. Sign in with the Plex account and complete the setup wizard; this claims the
   server to that account.

## Add the media library

After claiming, in **Settings → Libraries → Add Library**:

1. Pick the library type (Movies / TV Shows / Other Videos).
2. **Browse for media folder** → `/data` (this is the NFS `media/` share, mounted
   read-only). Point at `/data` or the relevant subfolder.
3. Save. Plex scans and populates as content lands in the share.

> The `media/` share may be empty or sparse right now; it's populated by the
> media pipeline (e.g. the dog-tv download job). The library will fill in on the
> next scan — no fake/placeholder entries are seeded.

## Notes

- Config/metadata survive pod restarts and re-deploys via the `plex-config`
  PVC. Deleting that PVC resets the server to unclaimed + empty.
- No hardware transcoding (OrbStack Linux VM has no GPU passthrough). Prefer
  direct-play clients; the memory limit is 1Gi.
</content>
</invoke>
