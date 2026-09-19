import { useDeviceName } from "../lib/device-name";
import { useIsMobile } from "../lib/mobile";
import { NotificationBanner } from "./ui/NotificationBanner";

// Single source of truth for the copy shown in the view below.
const MESSAGE = "Please set your device name in settings";

/**
 * Un-dismissable RED banner (top-right inside .board) shown until the user has
 * explicitly set a device name.
 *
 * Ticket #63: this used to also raise into the shared notifications store
 * (like ConnectionLostBanner), which meant a one-time setup
 * nag was creating a persistent `notifications.raise` row every time it fired.
 * It is now a pure presentational read of useDeviceName().isSet with no
 * notification-center side effect , the live board banner is signal enough for
 * a thing you fix once during setup.
 *
 * There is intentionally NO dismiss control and no clear path other than the
 * name becoming set , the banner exists to force the one-time setup, so it must
 * not be silence-able.
 *
 * Which is exactly why it must never fire on a phone. The name exists to label
 * a PANEL's log lines ("which wall panel wrote this?"), and every panel gets set
 * up once by hand. A phone opening the same app is a transient visitor: the
 * auto-derived default ("iPhone", see lib/device-name.ts deriveDefaultName) is
 * already the right answer, so demanding a hand-typed name gave an
 * un-dismissable red banner for a setup step there is no reason to perform. The
 * name stays editable in Settings > Device from a phone , it is just no longer
 * required. Guarded here, not only in the phone view, so the nag cannot return
 * by being mounted somewhere else.
 */
export function DeviceNameBanner() {
  const { isSet } = useDeviceName();
  const isMobile = useIsMobile();

  if (isMobile || isSet) return null;

  return <DeviceNameBannerView />;
}

/** Presentational banner, exported for Storybook. */
function DeviceNameBannerView() {
  // Critical one-time setup nag → assertive so it interrupts.
  return (
    <NotificationBanner tone="red" role="alert" ariaLive="assertive">
      {MESSAGE}
    </NotificationBanner>
  );
}
