/**
 * WeightTile — container for the Weight tile (spec
 * 2026-07-21-weight-tile-design). Polls weight.summary (30d window) every 60s
 * and maps it onto WeightTileView. kg→lb conversion happens once here; the
 * view and everything below it speak lb only.
 */

import { TileStatus } from "@/components/ui";
import { POLL, useNow } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import { formatRecency, WeightTileView } from "./WeightTileView";

// Duplicated from the api's weight-domain on purpose: web must not import api
// runtime code.
export const LB_PER_KG = 2.2046226218;

export function WeightTile() {
  const tile = useTileQuery(
    trpc.weight.summary.useQuery({ range: "30d" }, { refetchInterval: POLL.weight }),
  );
  const now = useNow();

  // Loading covers error-with-nothing-cached AND the day-one null summary
  // (no included readings yet): skeleton, never invented data.
  if (tile.status !== TileStatus.Populated) {
    return <WeightTileView status={tile.status} />;
  }

  const data = tile.data;
  return (
    <WeightTileView
      status={TileStatus.Populated}
      lb={data.latestKg * LB_PER_KG}
      recencyLabel={formatRecency(data.latestAt, now)}
      // A 1-day window has no change to speak of; hide the badge until 2+ days.
      deltaLb30={data.daily.length >= 2 ? data.change * LB_PER_KG : undefined}
      spark={data.daily.map((d) => d.kg * LB_PER_KG)}
    />
  );
}
