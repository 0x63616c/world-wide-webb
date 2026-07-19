/**
 * PushRegistrar , renders nothing; re-registers this device with APNs on every
 * app launch when push is enabled.
 *
 * Why this exists: `pushEnabled` is a persisted device-local setting, and
 * `enablePush()` used to run ONLY on the settings toggle's off→on transition.
 * Once the flag was true, nothing ever called `register()` again , so a device
 * whose token never reached the server (or whose token later changed) was stuck
 * permanently: the UI said push was on, and no registration was ever retried.
 * That is exactly how a phone ended up with permission granted, the toggle on,
 * and zero rows in device_push_token.
 *
 * Re-registering at boot is also simply correct for APNs: tokens are not stable.
 * They rotate on reinstall, on restore-from-backup, and occasionally on OS
 * upgrade, so the documented guidance is to call register() every launch and
 * upsert whatever token comes back. `registerToken` is an idempotent upsert
 * keyed by device id, so repeat calls cost one row-write and nothing else.
 *
 * Mounted beside NotificationBridge rather than inside the settings page,
 * because Settings is not opened on a normal launch , which was the whole bug.
 */

import { useEffect, useRef } from "react";
import { log } from "../lib/log/logger";
import { enablePush } from "../lib/push";
import { useSettings } from "../lib/settings";
import { trpc } from "../lib/trpc";

const pushLog = log.child("push");

export function PushRegistrar() {
  const { pushEnabled } = useSettings();
  const registerToken = trpc.notifications.registerToken.useMutation();

  // Ref-routed so the effect depends only on `pushEnabled`: a fresh mutate
  // closure on every render must not re-trigger registration.
  const mutateRef = useRef(registerToken.mutate);
  mutateRef.current = registerToken.mutate;

  // Latched so a re-render (or a settings poll re-emitting the same value)
  // cannot register twice in one session. A genuine relaunch remounts this.
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (!pushEnabled || attemptedRef.current) return;
    attemptedRef.current = true;

    // Off the native shell this resolves "unsupported" and does nothing, so no
    // platform check is needed here.
    void enablePush((input) => mutateRef.current(input)).then((result) => {
      if (result.ok) {
        pushLog.info("re-registered with APNs at launch");
        return;
      }
      // Do NOT flip pushEnabled off here. The user's intent is still "on"; a
      // transient failure (offline at launch, APNs unreachable) must not
      // silently disable push and require them to notice and re-enable it.
      pushLog.warn("launch re-registration failed", { reason: result.reason });
    });
  }, [pushEnabled]);

  return null;
}
