import { afterEach, describe, expect, it, vi } from "vitest";
import { attachCamera, type BoardCameraHost, boardCamera } from "../index";

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

describe("boardCamera singleton", () => {
  afterEach(() => vi.restoreAllMocks());

  function attachFake(over: Partial<BoardCameraHost> = {}) {
    const scrollTo = vi.fn();
    const stage = fakeStage({ scrollTo });
    const detach = attachCamera({
      stage,
      home: () => ({ cx: 9000, cy: 8000 }),
      tileCenter: () => undefined,
      ...over,
    });
    return { scrollTo, stage, detach };
  }

  it("panTo({x,y}) native-scrolls the point to the viewport center", () => {
    const { scrollTo, detach } = attachFake();
    boardCamera.panTo({ x: 5000, y: 4000 });
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

  it("glideHome native-scrolls to the home center", () => {
    const { scrollTo, detach } = attachFake();
    boardCamera.glideHome();
    expect(scrollTo).toHaveBeenCalledWith({
      left: 9000 - 683,
      top: 8000 - 512,
      behavior: "smooth",
    });
    detach();
  });

  it("falls back to an instant set where scrollTo is absent (test/SSR env)", () => {
    const stage = fakeStage({ scrollTo: undefined });
    const detach = attachCamera({
      stage,
      home: () => ({ cx: 9000, cy: 8000 }),
      tileCenter: () => undefined,
    });
    boardCamera.panTo({ x: 5000, y: 4000 });
    expect(stage.scrollLeft).toBe(5000 - 683);
    expect(stage.scrollTop).toBe(4000 - 512);
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
