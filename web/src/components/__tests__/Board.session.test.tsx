/**
 * Panel-session integration: the REAL Board wired to the REAL panel-session
 * clock (lib/panel-session). Successor to Board.idle.test.tsx +
 * Board.dim-overlay.test.tsx , the idle-reset and idle-dim timers they covered
 * are now one activity clock whose SESSION END dims + glides home + relocks.
 *
 * Native display is mocked true so the session is enabled (it is native-only,
 * matching the old idle-dim gate); the panel-session singleton is reset around
 * every test since it lives outside React.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tileWorldRect } from "../../lib/grid-constants";

const HOME_RECT = tileWorldRect({ worldCol: 26, worldRow: 27, cols: 4, rows: 2 });
const HOME_CX = HOME_RECT.x + HOME_RECT.w / 2;
const HOME_CY = HOME_RECT.y + HOME_RECT.h / 2;
const CLIENT_W = 1366;
const CLIENT_H = 1024;
const TIMEOUT_MS = 60_000;

const tileTap = vi.fn();

vi.mock("../../lib/tile-registry", () => {
  const fake = {
    id: "tile_fake",
    label: "Fake Tile",
    component: () => (
      <button type="button" onClick={() => tileTap()}>
        tile-body
      </button>
    ),
    viewComponent: () => null,
    worldCol: 26,
    worldRow: 27,
    cols: 4,
    rows: 2,
    home: true,
  };
  return { TILE_REGISTRY: [fake], HOME_TILE: fake };
});
vi.mock("../../lib/useBoardLayout", async () => {
  const { resolveLayout } = await import("../../lib/board-layout");
  const { TILE_REGISTRY } = await import("../../lib/tile-registry");
  return {
    useBoardLayout: () => ({
      status: "ready" as const,
      layout: resolveLayout([], TILE_REGISTRY),
      revision: null,
      refetch: () => {},
    }),
  };
});
vi.mock("../ConnectionLostBanner", () => ({ ConnectionLostBanner: () => null }));
vi.mock("../tiles/detail/registry", () => ({ getTileDetailEntry: () => undefined }));
// Native so the session is enabled; the backlight calls are inert.
vi.mock("../../lib/brightness", () => ({
  isNativeDisplay: () => true,
  dimTo: vi.fn(() => Promise.resolve()),
  wakeTo: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../lib/wake-capture", () => ({ captureWakeBurst: vi.fn() }));

import { __resetSessionForTests, panelSession } from "../../lib/panel-session";
import { resetSettings, setIdleDimEnabled, setIdleDimTimeoutMs } from "../../lib/settings";
import { Board } from "../Board";

beforeEach(() => {
  vi.useFakeTimers();
  __resetSessionForTests();
  resetSettings();
  setIdleDimEnabled(true);
  setIdleDimTimeoutMs(TIMEOUT_MS);
  // jsdom has no scrollTo; the glide-home jumpTo calls it directly (no fallback).
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    writable: true,
    value: () => {},
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return this.id === "stage" ? CLIENT_W : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return this.id === "stage" ? CLIENT_H : 0;
    },
  });
});

afterEach(() => {
  cleanup();
  __resetSessionForTests();
  resetSettings();
  vi.useRealTimers();
  vi.restoreAllMocks();
  tileTap.mockClear();
});

// Capture the glide-home scrollTo target while still letting scroll writes land.
function captureScrollTo(stage: HTMLElement) {
  const calls: Array<{ left: number; top: number }> = [];
  stage.scrollTo = ((opts: ScrollToOptions) => {
    if (opts && typeof opts.left === "number" && typeof opts.top === "number") {
      calls.push({ left: opts.left, top: opts.top });
      stage.scrollLeft = opts.left;
      stage.scrollTop = opts.top;
    }
  }) as typeof stage.scrollTo;
  return calls;
}

describe("Board panel-session wiring", () => {
  it("ends the session after the idle timeout: dims, glides home, relocks", () => {
    render(<Board />);
    const stage = document.getElementById("stage") as HTMLElement;
    const calls = captureScrollTo(stage);

    // Unlock the session, then pan away so the glide-home target is non-trivial.
    act(() => panelSession.unlock());
    expect(panelSession.isUnlocked()).toBe(true);
    stage.scrollLeft = HOME_CX + 4000;
    stage.scrollTop = HOME_CY + 4000;

    act(() => {
      vi.advanceTimersByTime(TIMEOUT_MS);
    });

    // Dimmed (shield up), relocked, and glided back to the home tile.
    expect(screen.getByTestId("dim-overlay")).toBeTruthy();
    expect(panelSession.isUnlocked()).toBe(false);
    const last = calls.at(-1);
    expect(last?.left).toBeCloseTo(HOME_CX - CLIENT_W / 2, 0);
    expect(last?.top).toBeCloseTo(HOME_CY - CLIENT_H / 2, 0);
  });

  it("swallows the wake tap: it never clicks the tile beneath, and rearms", () => {
    render(<Board />);
    act(() => {
      vi.advanceTimersByTime(TIMEOUT_MS);
    });
    const overlay = screen.getByTestId("dim-overlay");

    // The tap wakes on pointerdown; the shield lingers to absorb the click.
    fireEvent.pointerDown(overlay);
    fireEvent.click(screen.getByTestId("dim-overlay"));
    expect(tileTap).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dim-overlay")).toBeNull();
    // Woken back to an active session.
    expect(panelSession.phase()).toBe("active");
  });

  it("ignores a raw window pointerdown while ended (shield stays up)", () => {
    render(<Board />);
    act(() => {
      vi.advanceTimersByTime(TIMEOUT_MS);
    });
    act(() => {
      window.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(screen.queryByTestId("dim-overlay")).toBeTruthy();
    expect(panelSession.phase()).toBe("ended");
  });

  it("a touch before the timeout rearms the clock", () => {
    render(<Board />);
    act(() => {
      vi.advanceTimersByTime(TIMEOUT_MS - 1_000);
      window.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      vi.advanceTimersByTime(TIMEOUT_MS - 1_000);
    });
    expect(screen.queryByTestId("dim-overlay")).toBeNull();
    expect(panelSession.phase()).toBe("active");
  });

  it("never ends the session while idle-dim is disabled", () => {
    setIdleDimEnabled(false);
    render(<Board />);
    act(() => {
      vi.advanceTimersByTime(TIMEOUT_MS * 3);
    });
    expect(screen.queryByTestId("dim-overlay")).toBeNull();
    expect(panelSession.phase()).toBe("active");
  });
});
