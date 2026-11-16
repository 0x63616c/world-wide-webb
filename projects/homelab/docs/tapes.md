# Tapes

Tapes (`projects/tapes/server`) serves the NAS video library to the Apple TV app on
`http://<mini LAN address>:4300`. It keeps watch progress in SQLite at
`/app/data/progress.sqlite` on the external `tapes_data` volume and needs no secrets.

## Release

CI builds `ghcr.io/0x63616c/www-tapes`. Promotion writes the tested digest to
`services/tapes/release.json`, validated by `scripts/promote-tapes.py`. The reconciler
refuses a missing or invalid pin. Private-image pulls use the existing SOPS registry
configuration ([secrets](secrets.md)).

## Library mount

Compose mounts the Synology export `192.168.0.218:/volume1/Tapes` read-only over NFSv4
(`soft`). The NAS NFS rule allows `192.168.0.0/24` read-only with `all_squash`. Docker
mounts NFS when the container starts: if the NAS is down then, the start fails and the
health gate reports `tapes` unhealthy. Start it again once the NAS is back.

## First-time setup

1. Wait for the first `release.json` pin to land on `main`.
2. As `_containers`, under `homelab-operation`, create the volume once in the Mini's
   `services` Docker runtime: `docker volume create tapes_data`. On first start Docker
   copies the image's UID 10001 `/app/data` into the empty volume. This is a one-time
   creation: a missing volume later must fail, not start with empty progress.
3. Add `tapes` to the Mini's services in `homelab.json` and land it through normal
   review. The transactional update reconciles it and requires the Docker health check.

## Backups and recovery

Full backups stop `tapes` and capture `/app/data` as `tapes-data.tar.gz`; the recovery
archive carries the Compose definition and `release.json`. The library itself is NAS
data and is not copied. To restore, verify the set with `scripts/verify-backup.py`,
extract `tapes-data.tar.gz` into a fresh `tapes_data` volume preserving UID/GID 10001,
then reconcile with the retained pin.
