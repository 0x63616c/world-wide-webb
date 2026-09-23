import { defineApp } from "@app-kit";
import { WifiTile } from "./web";

/**
 * The Wi-Fi app manifest. One 2x2 tile: a scannable QR code that joins the
 * guest network, drawn straight onto the tile surface (no white card) so a
 * phone can scan it off the wall panel. FACE-ONLY — nothing opens; the code
 * IS the feature. Not `home` (Controls is).
 *
 * On the fixed board it fills the slot under Activity, in the 2-wide column
 * between Controls and the Sound System / Clock stack.
 */
export default defineApp({
  id: "tile_wifi",
  tiles: [
    {
      id: "tile_wifi",
      label: "Wi-Fi",
      component: WifiTile,
      viewComponent: WifiTile,
      worldCol: 27,
      worldRow: 28,
      cols: 2,
      rows: 2,
    },
  ],
});
