import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// A fake one-tile registry so Board can be exercised without loading real tiles
// (or their transitive deps like maplibre-gl) in jsdom. The fake tile renders an
// inner button so we can prove control taps don't open the modal.
vi.mock("../../lib/tile-registry", () => ({
  TILE_REGISTRY: [
    {
      id: "tile_fake",
      label: "Fake Tile",
      component: () => (
        <div>
          tile-body
          <button type="button">inner-control</button>
        </div>
      ),
      viewComponent: () => null,
      gridArea: "fake",
      colStart: 1,
      rowStart: 1,
      cols: 4,
      rows: 2,
    },
  ],
  deriveGridAreas: () => '""',
}));
vi.mock("../ConnectionLostBanner", () => ({ ConnectionLostBanner: () => null }));

// Fake modal registry: tile_fake opens a single-variant modal.
vi.mock("../tiles/modals/registry", () => ({
  getTileModalEntry: (id: string) =>
    id === "tile_fake"
      ? {
          tileId: "tile_fake",
          defaultSlug: "v1",
          useVariants: () => ({
            loading: false,
            variants: [
              {
                slug: "v1",
                label: "V1",
                render: (open: boolean) =>
                  open ? <div data-testid="fake-modal">fake-modal-content</div> : null,
              },
            ],
          }),
        }
      : undefined,
}));

import { Board } from "../Board";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Board", () => {
  it("renders a #stage element", () => {
    render(<Board />);
    expect(document.getElementById("stage")).not.toBeNull();
  });

  it("renders a #scaler element inside #stage", () => {
    render(<Board />);
    expect(document.getElementById("scaler")).not.toBeNull();
  });

  it("tapping a tile opens its detail modal", () => {
    render(<Board />);
    expect(screen.queryByTestId("fake-modal")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Fake Tile" }));

    expect(screen.getByTestId("fake-modal").textContent).toContain("fake-modal-content");
  });

  it("tapping an inner control does NOT open the modal", () => {
    render(<Board />);
    fireEvent.click(screen.getByRole("button", { name: "inner-control" }));
    expect(screen.queryByTestId("fake-modal")).toBeNull();
  });
});
