import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tileWorldRect, WORLD_H, WORLD_W } from "../../lib/grid-constants";

// Home is the Clock-equivalent home tile's center, not the geometric world
// center , mirrors Board.idle.test.tsx.
const HOME_RECT = tileWorldRect({ worldCol: 26, worldRow: 27, cols: 4, rows: 2 });
const HOME_CX = HOME_RECT.x + HOME_RECT.w / 2;
const HOME_CY = HOME_RECT.y + HOME_RECT.h / 2;

// Controllable "is the layout editor open" flag the store mock below reads.
// Tests flip it directly rather than driving the real openLayoutEditor()/
// closeLayoutEditor() flow, since this suite is only exercising Board's
// wiring against the store's public read hook, not the store itself.
let layoutEditOpen = false;

vi.mock("../../lib/layout-edit-store", () => ({
  useLayoutEditorOpen: () => layoutEditOpen,
  openLayoutEditor: () => {
    layoutEditOpen = true;
  },
  closeLayoutEditor: () => {
    layoutEditOpen = false;
  },
}));

// The real LayoutEditor pulls in trpc mutations + the full tile registry; stub
// it so this suite only asserts Board's mount/hide wiring around it.
vi.mock("../layout-editor/LayoutEditor", () => ({
  LayoutEditor: () => <div data-testid="layout-editor-stub">layout-editor</div>,
}));

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

// Captures the options passed to useBoardLayout on the most recent render, so
// the poll-pause wiring (`enabled: !layoutEditOpen`) can be asserted without a
// real tRPC/React-Query stack.
let lastUseBoardLayoutOptions: { enabled?: boolean } | undefined;

vi.mock("../../lib/useBoardLayout", async () => {
  const { resolveLayout } = await import("../../lib/board-layout");
  const { TILE_REGISTRY } = await import("../../lib/tile-registry");
  return {
    useBoardLayout: (options?: { enabled?: boolean }) => {
      lastUseBoardLayoutOptions = options;
      return {
        status: "ready" as const,
        layout: resolveLayout([], TILE_REGISTRY),
        revision: null,
        refetch: () => {},
      };
    },
  };
});
vi.mock("../ConnectionLostBanner", () => ({ ConnectionLostBanner: () => null }));
vi.mock("../tiles/modals/registry", () => ({ getTileModalEntry: () => undefined }));

import { Board } from "../Board";
import { IDLE_RESET_MS } from "../hooks/useBoard";

const CLIENT_W = 1366;
const CLIENT_H = 1024;

beforeEach(() => {
  layoutEditOpen = false;
  lastUseBoardLayoutOptions = undefined;
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

function panAway(stage: HTMLElement) {
  const calls: Array<{ left: number; top: number }> = [];
  stage.scrollTo = ((opts: ScrollToOptions) => {
    if (opts && typeof opts.left === "number" && typeof opts.top === "number") {
      calls.push({ left: opts.left, top: opts.top });
      stage.scrollLeft = opts.left;
      stage.scrollTop = opts.top;
    }
  }) as typeof stage.scrollTo;
  stage.scrollLeft = WORLD_W;
  stage.scrollTop = WORLD_H;
  fireEvent.scroll(stage);
  return calls;
}

describe("Board , layout edit mode integration", () => {
  it("hides Minimap, CenteredTileLabel, and SettingsButton while the editor is open", () => {
    layoutEditOpen = false;
    const { rerender } = render(<Board />);
    expect(screen.getByTestId("minimap-root")).toBeTruthy();
    expect(screen.getByTestId("centered-tile-label")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();

    layoutEditOpen = true;
    rerender(<Board />);
    expect(screen.queryByTestId("minimap-root")).toBeNull();
    expect(screen.queryByTestId("centered-tile-label")).toBeNull();
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
  });

  it("mounts the LayoutEditor overlay only while open", () => {
    layoutEditOpen = false;
    const { rerender } = render(<Board />);
    expect(screen.queryByTestId("layout-editor-stub")).toBeNull();

    layoutEditOpen = true;
    rerender(<Board />);
    expect(screen.getByTestId("layout-editor-stub")).toBeTruthy();
  });

  it("mounts the LayoutEditor overlay outside the transformed/scrolled #stage subtree", () => {
    // Regression guard: #stage is the native scroll container (scrollLeft/Top
    // drive panning), so any fixed-position chrome nested inside it renders at
    // #stage's current board-world scroll offset if an intervening ancestor
    // also carries a CSS transform (the entrance-animation wrapper does) ,
    // completely offscreen, even though the DOM nodes all exist. The overlay
    // must NOT be a descendant of #stage at all.
    layoutEditOpen = true;
    render(<Board />);
    const stage = document.getElementById("stage") as HTMLElement;
    const overlay = screen.getByTestId("layout-editor-stub");
    expect(stage.contains(overlay)).toBe(false);
  });

  it("passes enabled: !layoutEditOpen through to useBoardLayout (poll pause)", () => {
    layoutEditOpen = false;
    const { rerender } = render(<Board />);
    expect(lastUseBoardLayoutOptions).toEqual({ enabled: true });

    layoutEditOpen = true;
    rerender(<Board />);
    expect(lastUseBoardLayoutOptions).toEqual({ enabled: false });
  });

  it("freezes native scroll (overflow/touchAction/scrollSnapType) while the editor is open", () => {
    layoutEditOpen = false;
    const { rerender } = render(<Board />);
    const stage = document.getElementById("stage") as HTMLElement;
    expect(stage.style.overflow).toBe("auto");

    layoutEditOpen = true;
    rerender(<Board />);
    expect(stage.style.overflow).toBe("hidden");
    expect(stage.style.touchAction).toBe("none");
  });

  it("disables the idle-reset glide-home while the editor is open", () => {
    layoutEditOpen = true;
    render(<Board />);
    const stage = document.getElementById("stage") as HTMLElement;
    const calls = panAway(stage);
    expect(calls).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(IDLE_RESET_MS * 2);
    });
    // No glide-home should fire while the editor is open , the recorded calls
    // stay empty (scrollTo is only ever invoked by panAway/goHome in this test).
    expect(calls).toHaveLength(0);
  });

  it("re-arms the idle-reset once the editor closes", () => {
    layoutEditOpen = true;
    const { rerender } = render(<Board />);
    const stage = document.getElementById("stage") as HTMLElement;
    const calls = panAway(stage);

    act(() => {
      vi.advanceTimersByTime(IDLE_RESET_MS * 2);
    });
    expect(calls).toHaveLength(0);

    layoutEditOpen = false;
    rerender(<Board />);
    act(() => {
      vi.advanceTimersByTime(IDLE_RESET_MS);
    });
    expect(calls.length).toBeGreaterThan(0);
    const last = calls.at(-1);
    expect(last?.left).toBeCloseTo(HOME_CX - CLIENT_W / 2, 0);
    expect(last?.top).toBeCloseTo(HOME_CY - CLIENT_H / 2, 0);
  });
});
