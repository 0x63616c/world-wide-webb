import { afterEach, describe, expect, it, vi } from "vitest";
import { isMobileDevice, isPhoneUserAgent, PHONE_MAX_WIDTH } from "../mobile";

// Real user agents, because the whole risk in this module is a string that looks
// like a phone but is the wall panel (or vice versa).
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD =
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const ANDROID_PHONE =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const ANDROID_TABLET =
  "Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function stubNavigator(userAgent: string, platform: string): void {
  Object.defineProperty(window.navigator, "userAgent", { value: userAgent, configurable: true });
  Object.defineProperty(window.navigator, "platform", { value: platform, configurable: true });
}

// jsdom's matchMedia never evaluates a query (it always reports matches:false),
// so the viewport half is driven by a stub that answers for one given width ,
// the same seam lib/useIsNarrow.ts reads.
function stubViewportWidth(width: number): void {
  vi.stubGlobal("matchMedia", (query: string) => {
    const max = Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? Number.NaN);
    return {
      matches: width <= max,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isPhoneUserAgent", () => {
  it("recognises iPhone and iPod", () => {
    expect(isPhoneUserAgent(IPHONE, "iPhone")).toBe(true);
    expect(isPhoneUserAgent("Mozilla/5.0 (iPod touch; CPU iPhone OS 17_5)", "")).toBe(true);
  });

  // The load-bearing case: the wall panel IS an iPad, and its UA carries the
  // same "Mobile/15E148" token an iPhone's does.
  it("never claims the iPad wall panel, despite its Mobile token", () => {
    expect(IPAD).toContain("Mobile");
    expect(isPhoneUserAgent(IPAD, "iPad")).toBe(false);
    expect(isPhoneUserAgent(IPAD, "MacIntel")).toBe(false);
  });

  it("leaves desktops alone", () => {
    expect(isPhoneUserAgent(MAC, "MacIntel")).toBe(false);
    expect(isPhoneUserAgent("", "")).toBe(false);
  });

  it("splits Android phones from Android tablets on the Mobile token", () => {
    expect(isPhoneUserAgent(ANDROID_PHONE, "Linux armv8l")).toBe(true);
    expect(isPhoneUserAgent(ANDROID_TABLET, "Linux armv8l")).toBe(false);
  });
});

describe("isMobileDevice", () => {
  // A phone in LANDSCAPE is wider than the breakpoint, which is exactly why the
  // user-agent half of the check exists.
  it("is true on a phone user agent at a non-narrow width", () => {
    stubNavigator(IPHONE, "iPhone");
    stubViewportWidth(852);
    expect(isMobileDevice()).toBe(true);
  });

  // What makes the phone view reachable in a desktop browser (and a component harness)
  // without spoofing a user agent.
  it("is true on a desktop user agent in a phone-narrow window", () => {
    stubNavigator(MAC, "MacIntel");
    stubViewportWidth(390);
    expect(isMobileDevice()).toBe(true);
    stubViewportWidth(PHONE_MAX_WIDTH);
    expect(isMobileDevice()).toBe(true);
  });

  it("is false on the wall panel", () => {
    stubNavigator(IPAD, "iPad");
    stubViewportWidth(1366);
    expect(isMobileDevice()).toBe(false);
  });

  it("is false on a desktop window just wider than the breakpoint", () => {
    stubNavigator(MAC, "MacIntel");
    stubViewportWidth(PHONE_MAX_WIDTH + 1);
    expect(isMobileDevice()).toBe(false);
  });
});
