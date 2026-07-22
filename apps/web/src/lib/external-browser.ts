/**
 * external-browser , open a URL in the OS in-app browser and keep the board's
 * idle reset honest about it.
 *
 * On iOS this is SFSafariViewController: a full-screen system overlay presented
 * ABOVE the webview, in its own process. That process isolation is the whole
 * point of SFSafariViewController, and it has one consequence that shapes this
 * module: while it is up our webview receives NO events. No touches, no
 * gestures, no visibility change. So there is no way to poke the board's idle
 * timer while someone is actually reading the page , the only signals we get
 * are "opened" and "dismissed".
 *
 * We therefore register as a dismissable modal (see modal-open-store) and let
 * the idle reset close the browser out from under the reader. That is the right
 * trade for a wall panel: an abandoned panel MUST find its way back to the
 * clock, and a panel stuck on github.com forever is a worse failure than a log
 * that closes while you are squinting at it. Reopen is one tap.
 *
 * If that becomes annoying in practice, the fix is a WKWebView (an in-app view
 * we own, whose touches are ours to observe) rather than a longer timeout , a
 * timeout cannot distinguish "reading" from "walked away" either.
 */

import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { registerOpenModal } from "./modal-open-store";

/** Matches --bg, so the Safari chrome reads as part of the Blackout theme. */
const TOOLBAR_COLOR = "#000000";

// Disposer for the in-flight browser session's modal registration. Held at
// module scope because open/close are separate user gestures: `close()` is
// driven by the OS "Done" button (browserFinished) or by the idle reset, not by
// the caller that opened it.
let releaseModal: (() => void) | null = null;

function cleanup(): void {
  releaseModal?.();
  releaseModal = null;
}

/**
 * Open `url` in the in-app browser. Off-device (browser dev, Storybook) there is
 * no SFSafariViewController, so fall back to a plain new tab and skip the modal
 * registration entirely , the idle reset is native-only anyway.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  // Re-entrancy: a second tap while one is already open must not leak the first
  // registration and pin the board's modal count above zero forever.
  cleanup();

  // Registered BEFORE the open await so an idle reset landing mid-present still
  // finds a dismisser to call.
  releaseModal = registerOpenModal(() => {
    void Browser.close();
  });

  // Fires when the sheet is dismissed by any route , the OS "Done" button, a
  // swipe-down, or our own Browser.close() from the idle reset.
  await Browser.removeAllListeners();
  await Browser.addListener("browserFinished", cleanup);

  try {
    await Browser.open({ url, toolbarColor: TOOLBAR_COLOR });
  } catch (err) {
    // The sheet never came up, so browserFinished will never fire to balance the
    // registration.
    cleanup();
    throw err;
  }
}
