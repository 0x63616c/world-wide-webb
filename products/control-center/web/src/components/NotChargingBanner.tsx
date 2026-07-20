import { useEffect } from "react";
import { useDeviceName } from "../lib/device-name";
import { useBatteryInfo } from "../lib/useBatteryInfo";
import { useNotifications } from "../lib/useNotifications";
import { NotificationBanner } from "./ui/NotificationBanner";

const NOTIF_ID = "battery-not-charging";
// Single source of truth so the DOM and the shared notifications store stay in
// sync. Named after the device rather than a hardcoded "iPad" so a push landing
// on a phone says which panel is unplugged.
const message = (deviceName: string) =>
  `${deviceName} is not connected to power or charging properly`;

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
  // Effective name, never empty (falls back to the platform default).
  const { name: deviceName } = useDeviceName();

  // null = unknown (off-device / unreadable battery) → treat as NOT a warning.
  const notCharging = battery !== null && battery.isCharging === false;

  useEffect(() => {
    if (notCharging) {
      raiseNotification({ id: NOTIF_ID, message: message(deviceName) });
    } else {
      clearNotification(NOTIF_ID);
    }
  }, [notCharging, deviceName, raiseNotification, clearNotification]);

  if (!notCharging) return null;

  return <NotChargingBannerView deviceName={deviceName} />;
}

/** Presentational banner, exported for Storybook. */
export function NotChargingBannerView({ deviceName }: { deviceName: string }) {
  return <NotificationBanner tone="red">{message(deviceName)}</NotificationBanner>;
}
