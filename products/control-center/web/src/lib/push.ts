/**
 * Push notifications , OS permission + APNs token registration for the iOS
 * shell, and a graceful no-op everywhere else.
 *
 * The board runs in three places: the Capacitor shell on the wall panel, a plain
 * browser during development, and jsdom/Storybook in CI. Only the first has a
 * push subsystem, so every entry point here resolves to an inert result off
 * device rather than throwing , a settings toggle must never explode in a
 * browser session.
 *
 * The @capacitor/push-notifications import is DYNAMIC so the plugin never loads
 * outside the native shell (mirrors lib/device-id.ts, lib/log/native.ts,
 * lib/app-update.ts). The plugin handle is also rebound onto a plain object
 * before being cached: the Capacitor proxy fabricates a method for ANY property
 * including `then`, so resolving a promise with the proxy itself would dispatch
 * a native "PushNotifications.then" call that rejects and poisons the chain
 * (the failure device-id.ts documents).
 *
 * Token delivery is a CALLBACK, not a return value: iOS hands the APNs token to
 * the `registration` listener asynchronously, some time after `register()`
 * resolves. So `enablePush` takes the register-token mutation as an argument and
 * calls it from that listener , this module never imports tRPC, which keeps it
 * unit-testable and free of React.
 */

import { getDeviceId } from "./device-id";
import { getDeviceName } from "./device-name";
import { log } from "./log/logger";

const pushLog = log.child("push");

/**
 * The APNs platform this shell registers under. `as const` (not a widened
 * string) so it satisfies the router's literal `platform: "ios"` , iOS is the
 * only shell today, and a widened type here would silently allow a value the
 * backend would reject at runtime.
 */
const PLATFORM = "ios" as const;

// ─── plugin surface (typed locally so tests can inject a fake) ────────────────

export interface PushPermissionStatus {
  receive: "prompt" | "prompt-with-rationale" | "granted" | "denied";
}

export interface PushRegistrationToken {
  value: string;
}

export interface PushPluginError {
  error: string;
}

/**
 * The four PushNotifications operations we use. Typed locally rather than
 * imported so this module compiles (and tests run) with no plugin present.
 */
export interface PushPlugin {
  checkPermissions(): Promise<PushPermissionStatus>;
  requestPermissions(): Promise<PushPermissionStatus>;
  register(): Promise<void>;
  addListener(
    event: "registration",
    handler: (token: PushRegistrationToken) => void,
  ): Promise<unknown>;
  addListener(
    event: "registrationError",
    handler: (error: PushPluginError) => void,
  ): Promise<unknown>;
}

/** The shape `enablePush` needs from the `notifications.registerToken` mutation. */
export interface RegisterTokenInput {
  deviceId: string;
  token: string;
  platform: typeof PLATFORM;
  deviceName: string;
}
export type RegisterTokenFn = (input: RegisterTokenInput) => void;

// Resolved once. `null` = not native / plugin missing / init failed.
let pluginPromise: Promise<PushPlugin | null> | null = null;
// Listeners are process-wide; attaching them twice would register the token
// twice per callback, so this latches after the first successful attach.
let listenersAttached = false;

function unproxyPush(plugin: PushPlugin): PushPlugin {
  return {
    checkPermissions: () => plugin.checkPermissions(),
    requestPermissions: () => plugin.requestPermissions(),
    register: () => plugin.register(),
    // Overloaded signature: widened to the union at the boundary and cast back,
    // because a plain forwarding arrow can't carry two call signatures.
    addListener: ((event: string, handler: (arg: never) => void) =>
      (plugin.addListener as (e: string, h: (arg: never) => void) => Promise<unknown>)(
        event,
        handler,
      )) as PushPlugin["addListener"],
  };
}

async function loadPlugin(): Promise<PushPlugin | null> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("PushNotifications")) {
      return null;
    }
    const { PushNotifications } = await import("@capacitor/push-notifications");
    return unproxyPush(PushNotifications as unknown as PushPlugin);
  } catch {
    return null;
  }
}

function getPlugin(): Promise<PushPlugin | null> {
  if (!pluginPromise) {
    // Belt and braces: getPlugin() must never reject , callers await it outside
    // their try blocks (off-device is a null return, not an error).
    pluginPromise = loadPlugin().catch(() => null);
  }
  return pluginPromise;
}

// ─── public API ───────────────────────────────────────────────────────────────

/** Why an enable attempt ended the way it did , surfaced to the settings UI. */
export type PushEnableResult =
  | { ok: true }
  /** Not the native shell (browser / Storybook / tests): nothing to enable. */
  | { ok: false; reason: "unsupported" }
  /** The user (or a previous "Don't allow") declined at the OS prompt. */
  | { ok: false; reason: "denied" }
  /** The plugin threw , registration could not be started. */
  | { ok: false; reason: "error" };

/**
 * Request permission, register with APNs, and persist the resulting token.
 *
 * `registerToken` is called from the plugin's `registration` listener, which
 * fires asynchronously AFTER this resolves , so `{ ok: true }` means "the OS
 * accepted and registration is under way", not "the token is stored". The
 * `registrationError` listener logs a warning; there is nothing to retry from
 * the UI, and a failed registration must not break the settings toggle.
 *
 * Never throws. Off device it returns `unsupported` without touching anything.
 */
export async function enablePush(registerToken: RegisterTokenFn): Promise<PushEnableResult> {
  const plugin = await getPlugin();
  if (!plugin) return { ok: false, reason: "unsupported" };

  try {
    // Check before prompting: iOS only ever shows the system prompt once, so a
    // previously-granted panel must not depend on a prompt that will not appear.
    let status = await plugin.checkPermissions();
    if (status.receive !== "granted") {
      status = await plugin.requestPermissions();
    }
    if (status.receive !== "granted") {
      pushLog.info("push permission not granted", { receive: status.receive });
      return { ok: false, reason: "denied" };
    }

    if (!listenersAttached) {
      await plugin.addListener("registration", (token: PushRegistrationToken) => {
        if (!token?.value) {
          pushLog.warn("registration fired with no token value");
          return;
        }
        pushLog.info("apns token received", { tokenLength: token.value.length });
        registerToken({
          deviceId: getDeviceId(),
          token: token.value,
          platform: PLATFORM,
          deviceName: getDeviceName(),
        });
      });

      await plugin.addListener("registrationError", (err: PushPluginError) => {
        // APNs registration failing is not fatal to the panel , the board keeps
        // working and the center still shows server-side rows. Log loudly so the
        // frontend_log table explains a panel that silently stops getting pushes.
        pushLog.warn("apns registration failed", { error: err?.error ?? "unknown" });
      });

      listenersAttached = true;
    }

    await plugin.register();
    return { ok: true };
  } catch (err) {
    pushLog.warn("enabling push failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "error" };
  }
}

/**
 * Current OS permission state, without prompting. Returns "unsupported" off
 * device so the settings page can explain why the toggle does nothing there.
 */
export async function pushPermissionState(): Promise<
  PushPermissionStatus["receive"] | "unsupported"
> {
  const plugin = await getPlugin();
  if (!plugin) return "unsupported";
  try {
    const status = await plugin.checkPermissions();
    return status.receive;
  } catch {
    return "unsupported";
  }
}

/** True when this build is running somewhere push can actually work. */
export async function isPushSupported(): Promise<boolean> {
  return (await getPlugin()) !== null;
}

/** Test seam: inject a fake plugin (or null to simulate off-device). */
export function setPushPluginForTests(plugin: PushPlugin | null): void {
  pluginPromise = Promise.resolve(plugin);
  listenersAttached = false;
}

/** Test seam: forget the cached plugin handle and listener latch. */
export function resetPushForTests(): void {
  pluginPromise = null;
  listenersAttached = false;
}
