import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enablePush,
  isPushSupported,
  type PushPermissionStatus,
  type PushPlugin,
  type PushPluginError,
  type PushRegistrationToken,
  pushPermissionState,
  resetPushForTests,
  setPushPluginForTests,
} from "../push";

afterEach(() => {
  resetPushForTests();
  vi.restoreAllMocks();
});

/** A fake plugin that captures the listeners so a test can fire them by hand. */
function fakePlugin(receive: PushPermissionStatus["receive"] = "granted") {
  const listeners: Record<string, (arg: never) => void> = {};
  const plugin: PushPlugin = {
    checkPermissions: vi.fn().mockResolvedValue({ receive }),
    requestPermissions: vi.fn().mockResolvedValue({ receive }),
    register: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn((event: string, handler: (arg: never) => void) => {
      listeners[event] = handler;
      return Promise.resolve({});
    }) as unknown as PushPlugin["addListener"],
  };
  const fireToken = (token: PushRegistrationToken) =>
    (listeners.registration as unknown as (t: PushRegistrationToken) => void)?.(token);
  const fireError = (err: PushPluginError) =>
    (listeners.registrationError as unknown as (e: PushPluginError) => void)?.(err);
  return { plugin, fireToken, fireError };
}

describe("off the native shell", () => {
  it("reports push as unsupported", async () => {
    setPushPluginForTests(null);
    expect(await isPushSupported()).toBe(false);
    expect(await pushPermissionState()).toBe("unsupported");
  });

  it("no-ops gracefully instead of throwing", async () => {
    setPushPluginForTests(null);
    const registerToken = vi.fn();
    await expect(enablePush(registerToken)).resolves.toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(registerToken).not.toHaveBeenCalled();
  });
});

describe("enablePush on native", () => {
  it("registers and forwards the token with device identity", async () => {
    const { plugin, fireToken } = fakePlugin("granted");
    setPushPluginForTests(plugin);
    const registerToken = vi.fn();

    await expect(enablePush(registerToken)).resolves.toEqual({ ok: true });
    expect(plugin.register).toHaveBeenCalled();
    // The token arrives asynchronously, AFTER enablePush resolves.
    expect(registerToken).not.toHaveBeenCalled();

    fireToken({ value: "apns-token-abc" });
    expect(registerToken).toHaveBeenCalledTimes(1);
    const input = registerToken.mock.calls[0][0];
    expect(input.token).toBe("apns-token-abc");
    expect(input.platform).toBe("ios");
    expect(input.deviceId).toBeTruthy();
    expect(typeof input.deviceName).toBe("string");
  });

  it("does not prompt when permission was already granted", async () => {
    const { plugin } = fakePlugin("granted");
    setPushPluginForTests(plugin);
    await enablePush(vi.fn());
    // iOS only ever shows the prompt once , a granted panel must not depend on
    // a prompt that will never appear again.
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
  });

  it("prompts when permission has not been decided", async () => {
    const { plugin } = fakePlugin("prompt");
    setPushPluginForTests(plugin);
    await enablePush(vi.fn());
    expect(plugin.requestPermissions).toHaveBeenCalled();
  });

  it("reports denial and never registers", async () => {
    const { plugin } = fakePlugin("denied");
    setPushPluginForTests(plugin);
    await expect(enablePush(vi.fn())).resolves.toEqual({ ok: false, reason: "denied" });
    expect(plugin.register).not.toHaveBeenCalled();
  });

  it("survives a registration error without throwing", async () => {
    const { plugin, fireError } = fakePlugin("granted");
    setPushPluginForTests(plugin);
    const registerToken = vi.fn();
    await enablePush(registerToken);
    expect(() => fireError({ error: "APNs said no" })).not.toThrow();
    expect(registerToken).not.toHaveBeenCalled();
  });

  it("ignores a registration callback with no token value", async () => {
    const { plugin, fireToken } = fakePlugin("granted");
    setPushPluginForTests(plugin);
    const registerToken = vi.fn();
    await enablePush(registerToken);
    fireToken({ value: "" });
    expect(registerToken).not.toHaveBeenCalled();
  });

  it("attaches listeners only once across repeated enables", async () => {
    const { plugin } = fakePlugin("granted");
    setPushPluginForTests(plugin);
    await enablePush(vi.fn());
    await enablePush(vi.fn());
    // Two listeners total (registration + registrationError), not four , a
    // second attach would register the token twice per callback.
    expect(plugin.addListener).toHaveBeenCalledTimes(2);
    expect(plugin.register).toHaveBeenCalledTimes(2);
  });

  it("returns an error result when the plugin throws", async () => {
    const plugin: PushPlugin = {
      checkPermissions: vi.fn().mockRejectedValue(new Error("boom")),
      requestPermissions: vi.fn(),
      register: vi.fn(),
      addListener: vi.fn() as unknown as PushPlugin["addListener"],
    };
    setPushPluginForTests(plugin);
    await expect(enablePush(vi.fn())).resolves.toEqual({ ok: false, reason: "error" });
  });
});

describe("pushPermissionState", () => {
  it("reports the OS state without prompting", async () => {
    const { plugin } = fakePlugin("denied");
    setPushPluginForTests(plugin);
    expect(await pushPermissionState()).toBe("denied");
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
  });
});
