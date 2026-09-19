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

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tileWorldRect } from "../../lib/grid-constants";

const HOME_RECT = tileWorldRect({ worldCol: 26, worldRow: 27, cols: 4, rows: 2 });
const HOME_CX = HOME_RECT.x + HOME_RECT.w / 2;
const HOME_CY = HOME_RECT.y + HOME_RECT.h / 2;
const CLIENT_W = 1366;
const CLIENT_H = 1024;
// The idle-dim timeout is a constant now (lib/settings.ts IDLE_DIM_TIMEOUT_MS),
// not a setting, so the tests run against that exact value.
const TIMEOUT_MS = 60_000;

const tileTap = vi.fn();

vi.mock("@features/_generated/web.gen", () => {
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
    access: { requiresSessionUnlock: false, requiresFreshUnlock: false },
  };
  return {
    TILE_REGISTRY: [fake],
    HOME_TILE: fake,
    accessFor: () => fake.access,
    registryEntryForTileId: (id: string) => (id === fake.id ? fake : undefined),
    getTileDetailEntry: () => undefined,
  };
});
vi.mock("../ConnectionLostBanner", () => ({ ConnectionLostBanner: () => null }));
// Native so the session is enabled; the backlight calls are inert.
vi.mock("../../lib/brightness", () => ({
  isNativeDisplay: () => true,
  dimTo: vi.fn(() => Promise.resolve()),
  wakeTo: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../lib/wake-capture", () => ({
  captureWakeBurst: vi.fn(),
  // DevicePage (rendered by the I-1 test below) polls this on mount.
  cameraPermissionState: vi.fn(() => Promise.resolve("granted")),
}));
// jsdom has no AudioContext; anything that reaches the sound bus is inert here.
vi.mock("../../lib/sound", () => ({
  playCue: vi.fn(),
  warmAudio: vi.fn(),
  useSoundReady: () => true,
}));

import { __resetSessionForTests, panelSession } from "../../lib/panel-session";
import { resetSettings } from "../../lib/settings";
import { closeSettings, openSettings } from "../../lib/settings-overlay-store";
import { Board } from "../Board";

beforeEach(() => {
  vi.useFakeTimers();
  __resetSessionForTests();
  resetSettings();
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
  closeSettings();
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

  it("session end with the Level sub-overlay open drops Settings entirely: no PIN gate on the dimmed board (final-review I-1)", () => {
    render(<Board />);
    // Unlocked session, Settings open on the Device page.
    act(() => {
      panelSession.unlock();
      openSettings();
    });
    // Open the full-screen Level from the Device page; SettingsPage closes
    // behind it, so only the Level overlay is registered as a dismissable
    // modal — exactly the leak path: dismissAllModals alone would close the
    // Level but strand settings-overlay-store's `open` against a dropped
    // unlock, mounting the PIN gate over the dimmed board.
    const levelRow = screen
      .getByText("Open the full screen level to adjust the mount.")
      .closest("div") as HTMLElement;
    fireEvent.click(within(levelRow.parentElement as HTMLElement).getByRole("button"));
    expect(screen.queryByTestId("pin-gate-backdrop")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(TIMEOUT_MS);
    });
    expect(panelSession.phase()).toBe("ended");
    expect(screen.queryByTestId("pin-gate-backdrop")).toBeNull();

    const overlay = screen.getByTestId("dim-overlay");
    fireEvent.pointerDown(overlay);
    fireEvent.click(screen.getByTestId("dim-overlay"));
    expect(panelSession.phase()).toBe("active");
    expect(screen.queryByTestId("pin-gate-backdrop")).toBeNull();
  });
});
