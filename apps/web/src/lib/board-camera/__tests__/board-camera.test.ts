import { afterEach, describe, expect, it, vi } from "vitest";
import { type Spring, smoothDamp } from "../camera";
import { centerOffset, glideTo, jumpTo } from "../glide";
import { attachCamera, type BoardCameraHost, boardCamera, cameraCancel } from "../index";

// A minimal stage stand-in: just the scroll geometry the camera math reads.
// clientWidth/Height are fixed at the panel size so the centering assertions
// track the real board (1366×1024 fixed wall panel).
function fakeStage(
  over: Partial<{
    scrollLeft: number;
    scrollTop: number;
    clientWidth: number;
    clientHeight: number;
    scrollTo: HTMLDivElement["scrollTo"];
  }> = {},
): HTMLDivElement {
  return {
    scrollLeft: 0,
    scrollTop: 0,
    clientWidth: 1366,
    clientHeight: 1024,
    ...over,
  } as unknown as HTMLDivElement;
}

function fakeSpring(): Spring & { calls: [number, number][] } {
  const calls: [number, number][] = [];
  return {
    calls,
    to: (_stage, left, top) => calls.push([left, top]),
    cancel: () => {},
    running: () => false,
  };
}

describe("centerOffset (glide target math)", () => {
  it("offsets a world point to the viewport center", () => {
    const stage = fakeStage({ clientWidth: 1366, clientHeight: 1024 });
    // toLeft = worldX - clientWidth/2, toTop = worldY - clientHeight/2.
    expect(centerOffset(stage, 5000, 4000)).toEqual({ left: 5000 - 683, top: 4000 - 512 });
  });
});

describe("glideTo dispatch (per snap mode)", () => {
  it("spring mode drives the JS spring with the centered offset", () => {
    const stage = fakeStage();
    const spring = fakeSpring();
    glideTo(stage, "spring", spring, 5000, 4000);
    expect(spring.calls).toEqual([[5000 - 683, 4000 - 512]]);
  });

  it("native modes use the browser smooth scroll", () => {
    const scrollTo = vi.fn();
    const stage = fakeStage({ scrollTo });
    const spring = fakeSpring();
    glideTo(stage, "mandatory", spring, 5000, 4000);
    expect(spring.calls).toHaveLength(0);
    expect(scrollTo).toHaveBeenCalledWith({
      left: 5000 - 683,
      top: 4000 - 512,
      behavior: "smooth",
    });
  });

  it("falls back to an instant set where scrollTo is absent (test/SSR env)", () => {
    const stage = fakeStage({ scrollTo: undefined });
    const spring = fakeSpring();
    glideTo(stage, "proximity", spring, 5000, 4000);
    expect(stage.scrollLeft).toBe(5000 - 683);
    expect(stage.scrollTop).toBe(4000 - 512);
  });
});

describe("jumpTo (native scroll, snap-mode independent)", () => {
  it("smooth centers via native scrollTo", () => {
    const scrollTo = vi.fn();
    const stage = fakeStage({ scrollTo });
    jumpTo(stage, 5000, 4000, true);
    expect(scrollTo).toHaveBeenCalledWith({
      left: 5000 - 683,
      top: 4000 - 512,
      behavior: "smooth",
    });
  });

  it("non-smooth centers instantly (auto)", () => {
    const scrollTo = vi.fn();
    const stage = fakeStage({ scrollTo });
    jumpTo(stage, 5000, 4000, false);
    expect(scrollTo).toHaveBeenCalledWith({ left: 5000 - 683, top: 4000 - 512, behavior: "auto" });
  });
});

describe("smoothDamp", () => {
  it("converges asymptotically toward the target", () => {
    let pos = 0;
    let vel = 0;
    for (let i = 0; i < 200; i++) {
      [pos, vel] = smoothDamp(pos, 100, vel, 0.32, 0.016);
    }
    expect(pos).toBeCloseTo(100, 4);
    expect(vel).toBeCloseTo(0, 4);
  });

  it("clamps to the target (vel 0) when a frame would overshoot", () => {
    // A large inbound velocity overshoots in one step → the guard snaps it home.
    const [pos, vel] = smoothDamp(0, 100, 100_000, 0.32, 0.05);
    expect(pos).toBe(100);
    expect(vel).toBe(0);
  });
});

describe("boardCamera singleton", () => {
  afterEach(() => vi.restoreAllMocks());

  function attachFake(over: Partial<BoardCameraHost> = {}) {
    const markUser = vi.fn();
    const markProgrammatic = vi.fn();
    const scrollTo = vi.fn();
    const stage = fakeStage({ scrollTo });
    const detach = attachCamera({
      stage,
      snapMode: () => "mandatory",
      home: () => ({ cx: 9000, cy: 8000 }),
      tileCenter: () => undefined,
      cellAt: () => undefined,
      interacting: () => false,
      markUser,
      markProgrammatic,
      ...over,
    });
    return { markUser, markProgrammatic, scrollTo, stage, detach };
  }

  it("panTo({x,y}) marks the move user-driven and native-scrolls to center", () => {
    const { markUser, markProgrammatic, scrollTo, detach } = attachFake();
    boardCamera.panTo({ x: 5000, y: 4000 });
    expect(markUser).toHaveBeenCalledOnce();
    expect(markProgrammatic).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith({
      left: 5000 - 683,
      top: 4000 - 512,
      behavior: "smooth",
    });
    detach();
  });

  it("panTo(tileId) resolves the tile center through the host", () => {
    const { scrollTo, detach } = attachFake({
      tileCenter: (id) => (id === "tile_x" ? { cx: 5000, cy: 4000 } : undefined),
    });
    boardCamera.panTo("tile_x");
    expect(scrollTo).toHaveBeenCalledWith({
      left: 5000 - 683,
      top: 4000 - 512,
      behavior: "smooth",
    });
    detach();
  });

  it("glideHome marks the move app-driven and native-scrolls to the home center", () => {
    const { markUser, markProgrammatic, scrollTo, detach } = attachFake();
    boardCamera.glideHome();
    expect(markProgrammatic).toHaveBeenCalledOnce();
    expect(markUser).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith({
      left: 9000 - 683,
      top: 8000 - 512,
      behavior: "smooth",
    });
    detach();
  });

  it("freeze suspends glides until unfreeze (layout-edit mode)", () => {
    const { scrollTo, detach } = attachFake();
    boardCamera.freeze();
    boardCamera.glideHome();
    boardCamera.panTo({ x: 5000, y: 4000 });
    expect(scrollTo).not.toHaveBeenCalled();

    boardCamera.unfreeze();
    boardCamera.glideHome();
    expect(scrollTo).toHaveBeenCalledWith({
      left: 9000 - 683,
      top: 8000 - 512,
      behavior: "smooth",
    });
    detach();
  });

  it("isSettling is false at rest and subscribe delivers change notifications", () => {
    const { detach } = attachFake();
    expect(boardCamera.isSettling()).toBe(false);
    const listener = vi.fn();
    const unsub = boardCamera.subscribe(listener);
    unsub();
    detach();
  });

  it("subscribers fire on the spring-mode settling false→true→false transition", () => {
    // rAF is stubbed so the spring kicks off but never advances itself , the
    // kickoff (false→true) and cancel (true→false) drive both edges of the
    // `isSettling` store deterministically, which the panel-session model reads.
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const { detach } = attachFake({ snapMode: () => "spring" });
    const listener = vi.fn();
    const unsub = boardCamera.subscribe(listener);

    // Kickoff: a spring-mode glide flips settling false→true.
    boardCamera.panTo({ x: 5000, y: 4000 });
    expect(boardCamera.isSettling()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    // Cancel: the spring aborts, flipping settling true→false.
    cameraCancel();
    expect(boardCamera.isSettling()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);

    unsub();
    detach();
  });

  it("no-ops once detached (guards a stale host)", () => {
    const { scrollTo, detach } = attachFake();
    detach();
    boardCamera.panTo({ x: 5000, y: 4000 });
    boardCamera.glideHome();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
