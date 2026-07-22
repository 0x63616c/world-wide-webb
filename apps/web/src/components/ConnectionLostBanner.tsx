import { useEffect } from "react";
import { useConnectionStatus } from "../lib/useConnectionStatus";
import { useNotifications } from "../lib/useNotifications";
import { NotificationBanner } from "./ui/NotificationBanner";

const NOTIF_ID = "connection-lost";
// Single source of truth so the DOM and the shared notifications store stay in sync.
const MESSAGE = "Unable to connect…";

/**
 * Absolutely-positioned banner (top-right inside .board) that surfaces when
 * the API is unreachable past the threshold. Feeds the shared notifications
 * store so the future www-awm title-bar can consume the same event without DOM
 * duplication , this component owns the visual until that bar lands.
 */
export function ConnectionLostBanner() {
  const { isLost, since } = useConnectionStatus();
  const { raiseNotification, clearNotification } = useNotifications();

  useEffect(() => {
    if (isLost) {
      raiseNotification({ id: NOTIF_ID, message: MESSAGE });
    } else {
      clearNotification(NOTIF_ID);
    }
  }, [isLost, raiseNotification, clearNotification]);

  if (!isLost || since === null) return null;

  return <NotificationBanner tone="amber">{MESSAGE}</NotificationBanner>;
}
