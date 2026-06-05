import { useEffect } from "react";
import { useConnectionStatus } from "../lib/useConnectionStatus";
import { useNotifications } from "../lib/useNotifications";

const NOTIF_ID = "connection-lost";
// Single source of truth so the DOM and the shared notifications store stay in sync.
const MESSAGE = "Unable to connect…";

/**
 * Absolutely-positioned banner (top-right inside .board) that surfaces when
 * the API is unreachable past the threshold. Feeds the shared notifications
 * store so the future CC-awm title-bar can consume the same event without DOM
 * duplication — this component owns the visual until that bar lands.
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

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "absolute",
        top: 18,
        right: 18,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px",
        borderRadius: 12,
        background: "rgba(244, 192, 99, 0.1)",
        border: "1px solid rgba(244, 192, 99, 0.35)",
        color: "var(--amber)",
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
          background: "var(--amber)",
          opacity: 0.8,
          flexShrink: 0,
        }}
      />
      <span>{MESSAGE}</span>
    </div>
  );
}
