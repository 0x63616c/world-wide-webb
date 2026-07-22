import { useEffect } from "react";
import { useDeviceName } from "../lib/device-name";
import { useNotifications } from "../lib/useNotifications";
import { NotificationBanner } from "./ui/NotificationBanner";

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
  // Critical one-time setup nag → assertive so it interrupts.
  return (
    <NotificationBanner tone="red" role="alert" ariaLive="assertive">
      {MESSAGE}
    </NotificationBanner>
  );
}
