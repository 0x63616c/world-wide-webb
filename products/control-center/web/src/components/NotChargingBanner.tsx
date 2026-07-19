import { useEffect } from "react";
import { useBatteryInfo } from "../lib/useBatteryInfo";
import { useNotifications } from "../lib/useNotifications";

const NOTIF_ID = "battery-not-charging";
// Single source of truth so the DOM and the shared notifications store stay in sync.
const MESSAGE = "iPad is not connected to power or charging properly";

/**
 * Prominent red banner (top-right inside .board) shown when the panel's own
 * battery reports it is NOT charging. The wall panel is meant to sit on dock
 * power permanently, so "not charging" is a real fault worth shouting about.
 *
 * Native-only: useBatteryInfo resolves null in a plain browser (dev/Storybook),
 * and null is treated as UNKNOWN (no warning) so a device without a readable
 * battery never raises a false positive. Feeds the shared notifications store
 * (same seam as the other banners) so notification-bridge mirrors it into the
 * persistent Notification Center.
 */
export function NotChargingBanner() {
  // Mounted for the panel's whole lifetime (unlike the settings-page battery
  // row), so this polls every 60s continuously.
  const battery = useBatteryInfo(true);
  const { raiseNotification, clearNotification } = useNotifications();

  // null = unknown (off-device / unreadable battery) → treat as NOT a warning.
  const notCharging = battery !== null && battery.isCharging === false;

  useEffect(() => {
    if (notCharging) {
      raiseNotification({ id: NOTIF_ID, message: MESSAGE });
    } else {
      clearNotification(NOTIF_ID);
    }
  }, [notCharging, raiseNotification, clearNotification]);

  if (!notCharging) return null;

  return <NotChargingBannerView />;
}

/** Presentational banner, exported for Storybook. */
export function NotChargingBannerView() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "absolute",
        // Fifth slot: below DeviceNameBanner (18), ConnectionLostBanner (62),
        // AppUpdateBanner (106), and UnplacedTilesBanner (150).
        top: 194,
        right: 18,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px",
        borderRadius: 12,
        background: "rgba(229, 72, 77, 0.1)",
        border: "1px solid rgba(229, 72, 77, 0.35)",
        color: "var(--red, #e5484d)",
        fontSize: 13,
        fontFamily: "var(--ui)",
        letterSpacing: "-0.01em",
        pointerEvents: "none",
        backdropFilter: "blur(6px)",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: "var(--red, #e5484d)",
          opacity: 0.8,
          flexShrink: 0,
        }}
      />
      <span>{MESSAGE}</span>
    </div>
  );
}
