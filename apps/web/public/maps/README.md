# Basemap tiles (`*.pmtiles`)

The Tesla tile's live map (`TeslaMap.tsx`) renders a [Protomaps](https://protomaps.com)
`.pmtiles` basemap via MapLibre GL over HTTP range requests. **No API key.**

The `.pmtiles` files are **gitignored** (hundreds of MB → too large for GitHub's
100 MB/file limit and LFS bandwidth quotas).

## Production: self-provisioning (www-hn1i)

Prod never serves a file from this directory. The web pod's `map-provision`
initContainer (`apps/map-provision/`) extracts `socal.pmtiles` into the `maps`
PVC before nginx starts (if-missing mode, instant no-op once provisioned), and
the monthly `map-extract` CronJob re-extracts in force mode. The Protomaps
build date is **resolved at runtime** from their build-metadata index ,
Protomaps deletes daily builds after ~7 days, so a hardcoded date rots (that
pin is what originally broke the prod map). Ad-hoc refresh:

```bash
kubectl create job --from=cronjob/map-extract map-extract-manual -n control-center
```

nginx serves `/maps/` with a real 404 when the file is missing (no SPA
index.html fallback), so a provisioning failure is loud.

## Local dev

- `socal.pmtiles`, Southern California extract, street-level (maxzoom 15), ~561 MB.

Requires the `pmtiles` CLI (`brew install pmtiles`). Extract a region from a
recent Protomaps daily planet build (list: <https://maps.protomaps.com/builds/>):

```bash
pmtiles extract "https://build.protomaps.com/<YYYYMMDD>.pmtiles" \
  apps/web/public/maps/socal.pmtiles \
  --bbox=-121.0,32.4,-114.0,35.9 --maxzoom=15
```

Wider CA + AZ + NV extent (~1-3 GB, never commit) is tracked by **www-gma**
(needs a `maps` PVC resize first).

The map source URL in `TeslaMap.tsx` is `pmtiles:///maps/socal.pmtiles` (served
from this directory in dev, from the PVC in prod). Map data © OpenStreetMap
contributors.
