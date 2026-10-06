// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bootReportScript,
  bootTimeoutMs,
  bootUrl,
  parseBootReport,
  RENDER_DEADLINE_MS,
  recoveryDelayMs,
} from "./boot-recovery";

describe("bootUrl", () => {
  it("bypasses the historical cached entry on the first load of every launch", () => {
    expect(bootUrl("https://app.worldwidewebb.co", 0, 100)).toBe(
      "https://app.worldwidewebb.co/?shellBoot=100-0",
    );
    expect(bootUrl("https://app.worldwidewebb.co", 0, 200)).toBe(
      "https://app.worldwidewebb.co/?shellBoot=200-0",
    );
  });

  it("busts the HTTP cache with a unique query on every retry", () => {
    expect(bootUrl("https://app.worldwidewebb.co", 1, 100)).toBe(
      "https://app.worldwidewebb.co/?shellBoot=100-1",
    );
    expect(bootUrl("http://localhost:4200/path?x=1#clock", 3, 100)).toBe(
      "http://localhost:4200/path?x=1&shellBoot=100-3#clock",
    );
    expect(bootUrl("https://app.worldwidewebb.co/?shellBoot=old", 1, 200)).toBe(
      "https://app.worldwidewebb.co/?shellBoot=200-1",
    );
  });
});

describe("recoveryDelayMs", () => {
  it("backs off exponentially from 1s and caps at 30s", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map(recoveryDelayMs)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
    ]);
  });
});

describe("bootTimeoutMs", () => {
  it("gives slow networks more time on each retry, up to 2 minutes", () => {
    expect([0, 1, 2, 3, 9].map(bootTimeoutMs)).toEqual([30_000, 60_000, 90_000, 120_000, 120_000]);
  });

  it("always outlasts the page's own render deadline", () => {
    expect(bootTimeoutMs(0)).toBeGreaterThan(RENDER_DEADLINE_MS);
  });
});

describe("parseBootReport", () => {
  it("accepts only well-formed shell reports", () => {
    expect(parseBootReport('{"channel":"control-center-shell","rendered":true}')).toEqual({
      channel: "control-center-shell",
      rendered: true,
    });
    expect(parseBootReport('{"channel":"control-center-native","id":"x"}')).toBeNull();
    expect(parseBootReport('{"channel":"control-center-shell","rendered":"yes"}')).toBeNull();
    expect(parseBootReport("not json")).toBeNull();
  });
});

describe("bootReportScript", () => {
  const posted: string[] = [];

  function runScript() {
    (window as unknown as { ReactNativeWebView: unknown }).ReactNativeWebView = {
      postMessage: (data: string) => posted.push(data),
    };
    // biome-ignore lint/security/noGlobalEval: exercising the injected script as the WebView runs it
    window.eval(bootReportScript);
  }

  afterEach(() => {
    vi.useRealTimers();
    posted.length = 0;
    document.body.innerHTML = "";
  });

  it("reports rendered as soon as the app mounts into #root", () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="root"></div>';
    runScript();
    expect(posted).toEqual([]);
    document.getElementById("root")?.appendChild(document.createElement("main"));
    vi.advanceTimersByTime(250);
    expect(posted.map(parseBootReport)).toEqual([
      { channel: "control-center-shell", rendered: true },
    ]);
  });

  it("reports blank when #root is still empty at the deadline", () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="root"></div>';
    runScript();
    vi.advanceTimersByTime(RENDER_DEADLINE_MS + 250);
    expect(posted.map(parseBootReport)).toEqual([
      { channel: "control-center-shell", rendered: false },
    ]);
  });

  it("reports blank for a page with no #root at all, such as an error page", () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<h1>502 Bad Gateway</h1>";
    runScript();
    vi.advanceTimersByTime(RENDER_DEADLINE_MS + 250);
    expect(posted.map(parseBootReport)).toEqual([
      { channel: "control-center-shell", rendered: false },
    ]);
  });
});
