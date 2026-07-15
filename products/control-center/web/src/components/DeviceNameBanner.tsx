import { useEffect } from "react";
import { useDeviceName } from "../lib/device-name";
import { useNotifications } from "../lib/useNotifications";

const NOTIF_ID = "device-name";
// Single source of truth so the DOM and the shared notifications store stay in sync.
const MESSAGE = "Please set your device name in settings";

/**
 * Un-dismissable RED banner (top-right inside .board) shown until the user has
 * explicitly set a device name. Follows the same www-awm seam as
 * ConnectionLostBanner / AppUpdateBanner: it raises into the shared notifications
 * store AND renders its own absolutely-positioned view.
 *
 * There is intentionally NO dismiss control and no clear path other than the
 * name becoming set , the banner exists to force the one-time setup, so it must
 * not be silence-able.
 */
export function DeviceNameBanner() {
  const { isSet } = useDeviceName();
  const { raiseNotification, clearNotification } = useNotifications();

  useEffect(() => {
    if (!isSet) {
      raiseNotification({ id: NOTIF_ID, message: MESSAGE });
    } else {
      clearNotification(NOTIF_ID);
    }
  }, [isSet, raiseNotification, clearNotification]);

  if (isSet) return null;

  return <DeviceNameBannerView />;
}

/** Presentational banner, exported for Storybook. */
export function DeviceNameBannerView() {
  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: "absolute",
        // Top slot: this is the persistent baseline banner, so it takes the prime
        // corner. ConnectionLost (62) and AppUpdate (106) stack below it.
        top: 18,
        right: 18,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px",
        borderRadius: 12,
        background: "rgba(229, 72, 77, 0.12)",
        border: "1px solid rgba(229, 72, 77, 0.4)",
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
          opacity: 0.85,
          flexShrink: 0,
        }}
      />
      <span>{MESSAGE}</span>
    </div>
  );
}
