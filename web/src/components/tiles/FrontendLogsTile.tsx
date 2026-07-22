/**
 * FrontendLogsTile , thin container for the Frontend Logs tile.
 *
 * Owns:
 *  - a periodic summarizeSince(now - 24h) walk over the on-device log store,
 *    flushed first so the tally includes lines still queued in memory
 *
 * Tapping the tile deep-links into Settings → Logs (behind the PIN gate, since
 * Settings is gated however it is reached) via the board's tile-detail registry
 * action entry (detail/wiring/frontend-logs.tsx); the tile face itself wires no
 * tap handler.
 *
 * No tRPC here: the data source is the panel's OWN IndexedDB log store, so
 * this polls a local summary instead of a query hook. One-minute cadence , the
 * tile is a 24h tally, so a minute of staleness is invisible, and each tick is
 * a single cursor walk over just the last day's slice.
 */

import { useCallback, useEffect, useState } from "react";
import { TileStatus } from "@/components/ui";
import { flushNow } from "../../lib/log/logger";
import * as store from "../../lib/log/store";
import { FrontendLogsTileView } from "./FrontendLogsTileView";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const BUCKETS = 24;
const REFRESH_MS = 60 * 1000;

type Summary = store.LogSummary;

export function FrontendLogsTile() {
  const [summary, setSummary] = useState<Summary | null>(null);

  const refresh = useCallback(async () => {
    await flushNow();
    const now = Date.now();
    setSummary(await store.summarizeSince(now - WINDOW_MS, now, BUCKETS));
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return summary === null ? (
    <FrontendLogsTileView status={TileStatus.Loading} />
  ) : (
    <FrontendLogsTileView
      status={TileStatus.Populated}
      counts={summary.counts}
      buckets={summary.buckets}
    />
  );
}
