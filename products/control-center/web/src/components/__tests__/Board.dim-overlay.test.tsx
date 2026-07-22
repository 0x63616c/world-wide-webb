/**
 * The wake tap must be FULLY swallowed by the dim overlay , pointerdown wakes
 * the panel, and the tap's synthesized click (which the browser fires after
 * pointerup, by which time `dimmed` is already false) must NOT retarget to the
 * tile under the finger. Regression: the overlay unmounted the instant dimmed
 * flipped, so every wake tap also "clicked" whatever it landed on.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tileTap = vi.fn();

// Same lightweight stubs as Board.idle.test.tsx so the REAL Board mounts in
// jsdom , this suite exercises the real useIdleDim wiring + DimOverlay.
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
// The detail registry imports real tile wiring (and transitively maplibre-gl),
// which jsdom cannot load , stub it so taps resolve to no detail entry.
vi.mock("../tiles/detail/registry", () => ({ getTileDetailEntry: () => undefined }));
// Native display so useIdleDim is enabled; backlight calls are inert.
vi.mock("../../lib/brightness", () => ({
  isNativeDisplay: () => true,
  dimTo: vi.fn(() => Promise.resolve()),
  wakeTo: vi.fn(() => Promise.resolve()),
}));
// The wake tap also fires the camera burst , keep it inert here.
vi.mock("../../lib/wake-capture", () => ({ captureWakeBurst: vi.fn() }));

import { Board } from "../Board";

describe("DimOverlay wake tap swallowing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    tileTap.mockClear();
  });

  function renderDimmedBoard() {
    const utils = render(<Board />);
    // Let the loading gate settle, then run the idle window down so the panel dims.
    act(() => {
      vi.advanceTimersByTime(10 * 60_000 + 1_000);
    });
    expect(screen.getByTestId("dim-overlay")).toBeTruthy();
    return utils;
  }

  it("wake tap's click is absorbed, then the shield unmounts", () => {
    renderDimmedBoard();
    const overlay = screen.getByTestId("dim-overlay");

    // The tap: pointerdown wakes (dimmed flips false), overlay lingers.
    fireEvent.pointerDown(overlay);
    expect(screen.queryByTestId("dim-overlay")).toBeTruthy();

    // The browser-synthesized click lands on the lingering shield, not a tile.
    fireEvent.click(screen.getByTestId("dim-overlay"));
    expect(tileTap).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dim-overlay")).toBeNull();
  });

  // Regression (fix #2): the idle timer's window-CAPTURE pointerdown listener
  // saw the wake tap before the overlay's own handler, un-dimmed, and React's
  // mid-dispatch flush (microtask checkpoint between listeners) unmounted the
  // shield before it could swallow anything , the tap clicked the tile under
  // the finger. While dimmed, raw window events must be inert.
  it("a raw window pointerdown while dimmed does not un-dim / unmount the shield", () => {
    renderDimmedBoard();

    act(() => {
      window.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(screen.queryByTestId("dim-overlay")).toBeTruthy();

    // The real tap still wakes through the shield, and its click is absorbed.
    fireEvent.pointerDown(screen.getByTestId("dim-overlay"));
    fireEvent.click(screen.getByTestId("dim-overlay"));
    expect(tileTap).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dim-overlay")).toBeNull();
  });

  it("fallback timer unmounts the shield when no click ever arrives", () => {
    renderDimmedBoard();
    fireEvent.pointerDown(screen.getByTestId("dim-overlay"));
    expect(screen.queryByTestId("dim-overlay")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.queryByTestId("dim-overlay")).toBeNull();
  });

  // The idle-hold seam: while something live holds the board awake (a running
  // timer on the open clock page), the panel must NOT dim; releasing the hold
  // re-arms a fresh dim window.
  it("does not dim while an idle hold is live, then dims after release", async () => {
    const { acquireIdleHold, resetIdleHoldsForTests } = await import("../../lib/idle-hold-store");
    try {
      render(<Board />);
      let release: () => void = () => {};
      act(() => {
        release = acquireIdleHold("test-live");
      });
      act(() => {
        vi.advanceTimersByTime(3 * (10 * 60_000 + 1_000));
      });
      expect(screen.queryByTestId("dim-overlay")).toBeNull();

      act(() => release());
      act(() => {
        vi.advanceTimersByTime(10 * 60_000 + 1_000);
      });
      expect(screen.getByTestId("dim-overlay")).toBeTruthy();
    } finally {
      resetIdleHoldsForTests();
    }
  });
});
