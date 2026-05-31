import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// A fake one-tile registry so Board can be exercised without loading real tiles
// (or their transitive deps like maplibre-gl) in jsdom. The fake tile renders an
// inner button so we can prove control taps don't open the showcase.
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

  it("tapping a tile opens its showcase modal with the main component", () => {
    render(<Board />);
    expect(screen.queryByTestId("tile-showcase")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Fake Tile" }));

    const showcase = screen.getByTestId("tile-showcase");
    // The showcase contains the tile's main component (rendered live).
    expect(showcase.textContent).toContain("tile-body");
    // And it's inside a dialog titled with the tile label.
    expect(screen.getByRole("dialog").textContent).toContain("Fake Tile");
  });

  it("tapping an inner control does NOT open the showcase", () => {
    render(<Board />);
    fireEvent.click(screen.getByRole("button", { name: "inner-control" }));
    expect(screen.queryByTestId("tile-showcase")).toBeNull();
  });
});
