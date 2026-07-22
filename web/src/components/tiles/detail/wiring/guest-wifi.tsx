/**
 * Guest Wi-Fi tile , action entry, not a page.
 *
 * The Guest tile's detail is deliberately a SMALL modal (one QR, design pick
 * 2026-07-19), not a full detail page, so the tap flips the
 * guest-wifi-modal-store flag and the always-mounted GuestWifiTile container
 * renders GuestWifiQrModal. Mirrors the Frontend Logs action shape.
 */

import { openGuestWifiModal } from "@/lib/guest-wifi-modal-store";
import type { TileDetailActionEntry } from "../types";

export const guestWifiDetailEntry: TileDetailActionEntry = {
  kind: "action",
  tileId: "tile_guestwifi",
  run: () => openGuestWifiModal(),
};
