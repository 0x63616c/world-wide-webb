/**
 * WakeCaptureDiagnostic , the muted "why are there no photos" line under the
 * Activity page empty state. Subscribes to the frontend log store (same seam as
 * LogsModal) and reads the most recent `wake`-source outcome back through the
 * pure `summariseWakeCapture`. Renders nothing when the panel has logged no wake
 * activity, so a plain browser / fresh boot just shows the normal empty copy.
 */

import { useSyncExternalStore } from "react";
import { getTail, subscribe } from "@/lib/log/logger";
import { summariseWakeCapture } from "@/lib/wake-log-summary";

export function WakeCaptureDiagnostic() {
  // useSyncExternalStore keeps this correct under concurrent React; getTail() is
  // memoized behind a dirty flag so it is a stable snapshot per write.
  const tail = useSyncExternalStore(subscribe, getTail);
  const status = summariseWakeCapture(tail);
  if (!status) return null;
  return (
    <div
      className="cap"
      data-testid="wake-diagnostic"
      style={{ marginTop: 10, color: "var(--ink-3)" }}
    >
      {status.text}
    </div>
  );
}
