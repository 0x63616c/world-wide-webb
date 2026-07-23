/**
 * Frontend Logs tile , action entry, not a page.
 *
 * The log viewer lives on the Settings → Logs page (behind the panel-session
 * PIN gate, however Settings is reached), so tapping the tile opens Settings on
 * that page via settings-overlay-store instead of opening a detail page. The
 * board's tap path runs `run()` for action entries; TileDetailHost ignores them.
 */

import type { TileDetailActionEntry } from "@/components/tiles/detail/types";
import { openSettings } from "@/lib/settings-overlay-store";

export const frontendLogsDetailEntry: TileDetailActionEntry = {
  kind: "action",
  tileId: "tile_felogs",
  run: () => openSettings("logs"),
};
