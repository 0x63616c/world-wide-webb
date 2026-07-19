/**
 * Frontend Logs tile , action entry, not a page.
 *
 * The log viewer lives on the Settings → Logs page (behind the Settings PIN
 * gate, however Settings is reached), so tapping the tile deep-links there via
 * open-settings-store instead of opening a detail page. The board's tap path
 * runs `run()` for action entries; TileDetailHost ignores them.
 */

import { openSettingsOnPage } from "@/lib/open-settings-store";
import type { TileDetailActionEntry } from "../types";

export const frontendLogsDetailEntry: TileDetailActionEntry = {
  kind: "action",
  tileId: "tile_felogs",
  run: () => openSettingsOnPage("logs"),
};
