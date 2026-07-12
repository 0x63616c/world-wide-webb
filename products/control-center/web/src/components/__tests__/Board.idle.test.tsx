import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tileWorldRect, WORLD_H, WORLD_W } from "../../lib/grid-constants";

// Home is the Clock-equivalent home tile's center, not the geometric world
// center. The mock registry below places its home tile at world cell (26,27),
// 4×2 , derive its pixel center so the assertions track the real Board.
const HOME_RECT = tileWorldRect({ worldCol: 26, worldRow: 27, cols: 4, rows: 2 });
const HOME_CX = HOME_RECT.x + HOME_RECT.w / 2;
const HOME_CY = HOME_RECT.y + HOME_RECT.h / 2;

// Same lightweight stubs as Board.test.tsx so the REAL Board mounts in jsdom
// without pulling maplibre/real tiles. This suite exercises the real idle-reset
// WIRING end to end (real useIdleReset + real goHome/jumpTo + real isHome against
// a real #stage element) , the unit tests mock goHome/isHome, so only this catches
// a broken integration (the gap that let www-9otn regress live).
vi.mock("../../lib/tile-registry", () => {
  const fake = {
    id: "tile_fake",
    label: "Fake Tile",
    component: () => <div>tile-body</div>,
    viewComponent: () => null,
    worldCol: 26,
    worldRow: 27,
    cols: 4,
    rows: 2,
    home: true,
  };
  return { TILE_REGISTRY: [fake], HOME_TILE: fake };
});
vi.mock("../ConnectionLostBanner", () => ({ ConnectionLostBanner: () => null }));
vi.mock("../tiles/modals/registry", () => ({ getTileModalEntry: () => undefined }));

import { Board } from "../Board";
import { IDLE_RESET_MS } from "../hooks/useBoard";

// jsdom gives every element clientWidth/Height 0 and no real layout. Pin a
// non-zero client size + a working scrollTo so isHome()/goHome() compute against
// realistic geometry (otherwise the world-center math degenerates).
const CLIENT_W = 1366;
const CLIENT_H = 1024;

beforeEach(() => {
  vi.useFakeTimers();
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
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
});

// Drive a real scroll so isHome() reads a real off-center position, then assert
// the idle reset glides back toward world-center via the real jumpTo→scrollTo.
function panAway(stage: HTMLElement) {
  // scrollTo is the channel goHome uses; capture targets while still letting the
  // imperative scrollLeft/Top writes through so isHome() reflects the pan.
  const calls: Array<{ left: number; top: number }> = [];
  stage.scrollTo = ((opts: ScrollToOptions) => {
    if (opts && typeof opts.left === "number" && typeof opts.top === "number") {
      calls.push({ left: opts.left, top: opts.top });
      stage.scrollLeft = opts.left;
      stage.scrollTop = opts.top;
    }
  }) as typeof stage.scrollTo;

  // Pan far from world-center so isHome() is decisively false.
  stage.scrollLeft = WORLD_W; // way past center
  stage.scrollTop = WORLD_H;
  fireEvent.scroll(stage);
  return calls;
}

describe("Board idle reset (real wiring)", () => {
  it("navigates back toward world-center after IDLE_RESET_MS on a non-home view", () => {
    render(<Board />);
    const stage = document.getElementById("stage") as HTMLElement;
    expect(stage).not.toBeNull();

    const calls = panAway(stage);
    // The pan itself must not have triggered a reset.
    expect(calls).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(IDLE_RESET_MS);
    });

    // goHome → jumpTo(HOME_CX, HOME_CY) → scrollTo with the home-tile target.
    expect(calls.length).toBeGreaterThan(0);
    const last = calls.at(-1);
    expect(last?.left).toBeCloseTo(HOME_CX - CLIENT_W / 2, 0);
    expect(last?.top).toBeCloseTo(HOME_CY - CLIENT_H / 2, 0);
  });

  it("a real interaction before the window resets the timer", () => {
    render(<Board />);
    const stage = document.getElementById("stage") as HTMLElement;
    const calls = panAway(stage);

    act(() => vi.advanceTimersByTime(IDLE_RESET_MS - 1_000));
    // A real tap (down → up) on the stage rearms the idle timer. The pointerup
    // matters: it clears the held-pointer ref so a later fire isn't deferred.
    fireEvent.pointerDown(stage);
    fireEvent.pointerUp(stage);
    act(() => vi.advanceTimersByTime(IDLE_RESET_MS - 1_000));
    expect(calls).toHaveLength(0);

    act(() => vi.advanceTimersByTime(1_000));
    expect(calls.length).toBeGreaterThan(0);
  });

  it("still resets after a canceled touch (pointercancel clears the held ref)", () => {
    // Regression for the live failure: an OS-stolen touch fires pointercancel
    // with no pointerup. If that left the held-pointer ref stuck true, fire()
    // would defer forever and the board would NEVER return home. pointercancel
    // must clear it so the idle reset still fires.
    render(<Board />);
    const stage = document.getElementById("stage") as HTMLElement;
    const calls = panAway(stage);

    fireEvent.pointerDown(stage);
    fireEvent.pointerCancel(stage); // OS steals the touch , no pointerup

    act(() => vi.advanceTimersByTime(IDLE_RESET_MS));
    expect(calls.length).toBeGreaterThan(0);
  });

  it("is a no-op when already centered on home", () => {
    render(<Board />);
    const stage = document.getElementById("stage") as HTMLElement;

    const calls: Array<{ left: number; top: number }> = [];
    stage.scrollTo = ((opts: ScrollToOptions) => {
      if (opts) calls.push({ left: opts.left ?? 0, top: opts.top ?? 0 });
    }) as typeof stage.scrollTo;

    // Park exactly on the home tile (the mount layout effect already centers it,
    // but assert it explicitly so the predicate input is unambiguous).
    stage.scrollLeft = HOME_CX - CLIENT_W / 2;
    stage.scrollTop = HOME_CY - CLIENT_H / 2;
    fireEvent.scroll(stage);

    act(() => vi.advanceTimersByTime(IDLE_RESET_MS * 2));
    expect(calls).toHaveLength(0);
  });
});
