import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// A fake one-tile registry so Board can be exercised without loading real
// tiles in jsdom. The fake tile renders an
// inner button so we can prove control taps don't open the detail page.
vi.mock("@features/_generated/web.gen", () => {
  const fake = {
    id: "tile_fake",
    label: "Fake Tile",
    component: () => (
      <div>
        tile-body
        <button type="button">inner-control</button>
      </div>
    ),
    viewComponent: () => null,
    worldCol: 26,
    worldRow: 27,
    cols: 4,
    rows: 2,
    home: true,
    access: { requiresSessionUnlock: false, requiresFreshUnlock: false },
  };
  const privateFake = {
    ...fake,
    id: "tile_private",
    label: "Private Tile",
    worldCol: 30,
    cols: 2,
    home: false,
    access: { requiresSessionUnlock: false, requiresFreshUnlock: true },
  };
  return {
    TILE_REGISTRY: [fake, privateFake],
    HOME_TILE: fake,
    accessFor: () => fake.access,
    registryEntryForTileId: (id: string) => (id === fake.id ? fake : undefined),
    getTileDetailEntry: (id: string) =>
      id === "tile_fake"
        ? {
            kind: "page" as const,
            tileId: "tile_fake",
            title: "Fake Tile",
            defaultSlug: "v1",
            useVariants: () => ({
              loading: false,
              variants: [
                {
                  slug: "v1",
                  label: "V1",
                  render: () => <div data-testid="fake-detail">fake-detail-content</div>,
                },
              ],
            }),
          }
        : undefined,
  };
});
vi.mock("../ConnectionLostBanner", () => ({ ConnectionLostBanner: () => null }));

import { closeTileDetail } from "../../lib/tile-detail-store";
import { Board } from "../Board";

afterEach(() => {
  cleanup();
  // The tile-detail store is module-global; drain it so an open page from one
  // test can't leak into the next.
  closeTileDetail();
  vi.restoreAllMocks();
});

describe("Board", () => {
  it("renders a #stage element", () => {
    render(<Board />);
    expect(document.getElementById("stage")).not.toBeNull();
  });

  it("renders the clipped #world inside #stage", () => {
    render(<Board />);
    const stage = document.getElementById("stage");
    const world = document.getElementById("world");
    expect(world).not.toBeNull();
    expect(stage?.contains(world ?? null)).toBe(true);
    expect(stage?.style.overflow).toBe("clip");
    expect(stage?.style.touchAction).toBe("none");
  });

  it("renders a private tile's locked face with the shared tile shape", () => {
    render(<Board />);
    const privateTile = screen.getByTestId("private-tile-tile_private");
    expect(privateTile.firstElementChild?.classList.contains("tile")).toBe(true);
    expect(privateTile.textContent).toContain("Private Tile");
    expect(privateTile.textContent).not.toContain("tile-body");
  });

  it("tapping a tile opens its detail page", () => {
    render(<Board />);
    expect(screen.queryByTestId("fake-detail")).toBeNull();
    const stage = document.getElementById("stage") as HTMLElement;
    const start = { left: stage.scrollLeft, top: stage.scrollTop };
    stage.scrollTo = vi.fn();

    fireEvent.click(screen.getByRole("button", { name: "Open Fake Tile" }));

    expect(screen.getByTestId("fake-detail").textContent).toContain("fake-detail-content");
    expect(stage.scrollTo).not.toHaveBeenCalled();
    expect({ left: stage.scrollLeft, top: stage.scrollTop }).toEqual(start);
  });

  it("tapping an inner control does NOT open the detail page", () => {
    render(<Board />);
    const stage = document.getElementById("stage") as HTMLElement;
    stage.scrollTo = vi.fn();
    fireEvent.click(screen.getByRole("button", { name: "inner-control" }));
    expect(screen.queryByTestId("fake-detail")).toBeNull();
    expect(stage.scrollTo).not.toHaveBeenCalled();
  });

  it("does not move on a mouse drag", () => {
    render(<Board />);
    const stage = document.getElementById("stage") as HTMLElement;
    const start = { left: stage.scrollLeft, top: stage.scrollTop };
    fireEvent.pointerDown(stage, { pointerType: "mouse", button: 0, clientX: 500, clientY: 500 });
    fireEvent.pointerMove(stage, { pointerType: "mouse", clientX: 100, clientY: 100 });
    fireEvent.pointerUp(stage);
    expect({ left: stage.scrollLeft, top: stage.scrollTop }).toEqual(start);
  });
});
