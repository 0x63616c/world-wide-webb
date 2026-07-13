/**
 * FrontendLogsTile , thin container for the Frontend Logs tile.
 *
 * Owns:
 *  - a periodic summarizeSince(now - 24h) walk over the on-device log store,
 *    flushed first so the tally includes lines still queued in memory
 *  - the LogsModal, opened by tapping the tile , the tile is the tell, the
 *    modal is the viewer
 *
 * No tRPC here: the data source is the panel's OWN IndexedDB log store, so
 * this polls a local summary instead of a query hook. One-minute cadence , the
 * tile is a 24h tally, so a minute of staleness is invisible, and each tick is
 * a single cursor walk over just the last day's slice. The summary refreshes
 * on modal close too, so a "what just happened" session ends with the tile
 * already agreeing with what the modal showed.
 */

import { useCallback, useEffect, useState } from "react";
import { TileStatus } from "@/components/ui";
import { flushNow } from "../../lib/log/logger";
import * as store from "../../lib/log/store";
import { LogsModal } from "../LogsModal";
import { FrontendLogsTileView } from "./FrontendLogsTileView";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const BUCKETS = 24;
const REFRESH_MS = 60 * 1000;

type Summary = store.LogSummary;

export function FrontendLogsTile() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

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

  const closeModal = useCallback(() => {
    setModalOpen(false);
    // The session in the modal may have flushed more history; land it now
    // rather than up to a minute later.
    void refresh();
  }, [refresh]);

  return (
    <>
      {summary === null ? (
        <FrontendLogsTileView status={TileStatus.Loading} />
      ) : (
        <FrontendLogsTileView
          status={TileStatus.Populated}
          counts={summary.counts}
          buckets={summary.buckets}
          onTileTap={() => setModalOpen(true)}
        />
      )}
      <LogsModal open={modalOpen} onClose={closeModal} />
    </>
  );
}
