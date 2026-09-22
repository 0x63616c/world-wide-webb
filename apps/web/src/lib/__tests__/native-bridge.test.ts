import { afterEach, describe, expect, it } from "vitest";
import { isNativeShell, nativeRequest } from "../native-bridge";

afterEach(() => {
  delete window.__CONTROL_CENTER_EXPO__;
  delete window.ReactNativeWebView;
});

describe("Expo native bridge", () => {
  it("stays unavailable in a normal browser", async () => {
    expect(isNativeShell()).toBe(false);
    await expect(nativeRequest("deviceInfo")).rejects.toThrow("unavailable");
  });

  it("round-trips a request through the WebView message channel", async () => {
    window.__CONTROL_CENTER_EXPO__ = true;
    window.ReactNativeWebView = {
      postMessage(message) {
        const request = JSON.parse(message) as { channel: string; id: string; method: string };
        window.dispatchEvent(
          new CustomEvent("control-center-native-response", {
            detail: {
              channel: request.channel,
              id: request.id,
              ok: true,
              result: { model: "iPad8,11", identifier: "abcdef01" },
            },
          }),
        );
      },
    };

    await expect(nativeRequest("deviceInfo")).resolves.toEqual({
      model: "iPad8,11",
      identifier: "abcdef01",
    });
  });
});
