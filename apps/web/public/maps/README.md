# Basemap tiles (`*.pmtiles`)

The Tesla tile's live map (`TeslaMap.tsx`) renders a [Protomaps](https://protomaps.com)
`.pmtiles` basemap via MapLibre GL over HTTP range requests. **No API key.**

The `.pmtiles` files are **gitignored** (hundreds of MB → too large for GitHub's
100 MB/file limit and LFS bandwidth quotas). They are hosted locally for now;
production hosting on the homelab is tracked by **CC-gma**.

## Current file

- `socal.pmtiles` — Southern California extract, street-level (maxzoom 15), ~561 MB.

## Rebuild / regenerate

Requires the `pmtiles` CLI (`brew install pmtiles`). Extract a region from the
Protomaps daily planet build (pick a recent date from <https://build.protomaps.com>):

```bash
# SoCal (current)
pmtiles extract "https://build.protomaps.com/<YYYYMMDD>.pmtiles" \
  apps/web/public/maps/socal.pmtiles \
  --bbox=-121.0,32.4,-114.0,35.9 --maxzoom=15

# Full CA + AZ + NV (CC-gma — ~1-3 GB, host on homelab, do NOT commit)
pmtiles extract "https://build.protomaps.com/<YYYYMMDD>.pmtiles" \
  apps/web/public/maps/socal.pmtiles \
  --bbox=-124.5,31.3,-109.0,42.1 --maxzoom=15
```

The map source URL in `TeslaMap.tsx` is `pmtiles:///maps/socal.pmtiles` (served
from this directory). Map data © OpenStreetMap contributors.
