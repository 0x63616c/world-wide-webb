import { useEffect } from "react";
import { useDeviceName } from "../lib/device-name";
import { useIsMobile } from "../lib/mobile";
import { useBatteryInfo } from "../lib/useBatteryInfo";
import { useNotifications } from "../lib/useNotifications";
import { NotificationBanner } from "./ui/NotificationBanner";

const NOTIF_ID = "battery-not-charging";
// Single source of truth so the DOM and the shared notifications store stay in
// sync. Named after the device rather than a hardcoded "iPad" so a push landing
// on a phone says which panel is unplugged.
//
// Split into headline + detail because this pair becomes an APNs alert's
// title/body (notification-bridge → apns.buildApnsPayload). iOS renders a
// notification title on ONE line and truncates it hard, so the headline stays
// short enough to survive that ("Kitchen Panel is not charging"), and the
// explanation and the thing to actually go do live in the body, which iOS wraps
// over two lines and expands on long-press.
const message = (deviceName: string) => `${deviceName} is not charging`;
const detail = "Running on battery. Check the dock cable and power adapter.";

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
 *
 * Never on a phone. "Not charging" is a fault statement about the WALL PANEL ,
 * it is docked and meant to be on power forever, so running on battery means
 * someone knocked the cable out. A phone runs on battery by design, and the
 * native build installed on an iPhone reported exactly this banner (plus a push,
 * via notification-bridge) for the entirely normal state of being unplugged.
 * The guard is here rather than only in the phone view so the banner cannot
 * fire from a phone wherever it is mounted , and, because it gates
 * useBatteryInfo's `enabled`, a phone does not even poll the battery for it.
 */
export function NotChargingBanner() {
  const isMobile = useIsMobile();
  // Mounted for the panel's whole lifetime (unlike the settings-page battery
  // row), so this polls every 60s continuously , but never on a phone.
  const battery = useBatteryInfo(!isMobile);
  const { raiseNotification, clearNotification } = useNotifications();
  // Effective name, never empty (falls back to the platform default).
  const { name: deviceName } = useDeviceName();

  // null = unknown (off-device / unreadable battery) → treat as NOT a warning.
  // `isMobile` is folded in here rather than only into the poll above so the
  // phone guard holds on the RENDER path too, not just by starving it of data:
  // notCharging false is also what makes the effect below clear the shared
  // notification, so a phone that raised it before this shipped cleans up on
  // its next launch.
  const notCharging = !isMobile && battery !== null && battery.isCharging === false;

  useEffect(() => {
    if (notCharging) {
      raiseNotification({ id: NOTIF_ID, message: message(deviceName), detail });
    } else {
      clearNotification(NOTIF_ID);
    }
  }, [notCharging, deviceName, raiseNotification, clearNotification]);

  if (!notCharging) return null;

  return <NotChargingBannerView deviceName={deviceName} />;
}

/** Presentational banner, exported for Storybook. */
function NotChargingBannerView({ deviceName }: { deviceName: string }) {
  // The panel banner has horizontal room the iOS title does not, so it shows
  // both halves: headline first, then the same detail line the push body uses.
  return (
    <NotificationBanner tone="red">
      {message(deviceName)} <span style={{ opacity: 0.75 }}>· {detail}</span>
    </NotificationBanner>
  );
}
