/**
 * Board tests for the useBoardLayout status/unplaced surface:
 *  - loading state renders the shimmer stage only, no #stage / no tiles.
 *  - the unplaced-tiles banner renders with the exact copy when `unplaced` is
 *    non-empty, and is absent when empty.
 *
 * Follows the same "stub useBoardLayout directly" precedent as Board.test.tsx
 * / Board.idle.test.tsx, but with a mutable mock return so each test can
 * drive status/unplaced independently.
 */
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

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

let mockLayoutReturn: {
  status: "loading" | "ready";
  layout: { tiles: unknown[]; unplaced: string[] };
  revision: string | null;
  refetch: () => void;
} = {
  status: "loading",
  layout: { tiles: [], unplaced: [] },
  revision: null,
  refetch: () => {},
};

vi.mock("../../lib/useBoardLayout", () => ({
  useBoardLayout: () => mockLayoutReturn,
}));
vi.mock("../ConnectionLostBanner", () => ({ ConnectionLostBanner: () => null }));
vi.mock("../tiles/modals/registry", () => ({ getTileModalEntry: () => undefined }));
// The detail registry imports real tile wiring (and transitively maplibre-gl),
// which jsdom cannot load , stub it so Board stays on the legacy modal path.
vi.mock("../tiles/detail/registry", () => ({ getTileDetailEntry: () => undefined }));

import { Board } from "../Board";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Board loading state", () => {
  it("renders the shimmer stage and no tiles while the layout is loading", () => {
    mockLayoutReturn = {
      status: "loading",
      layout: { tiles: [], unplaced: [] },
      revision: null,
      refetch: () => {},
    };
    render(<Board />);

    expect(screen.getByTestId("board-loading")).toBeInTheDocument();
    expect(document.getElementById("stage")).toBeNull();
    expect(screen.queryByText("Fake Tile")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Fake Tile" })).not.toBeInTheDocument();
  });
});

describe("Board unplaced-tiles banner", () => {
  const readyWithTiles = (unplaced: string[]) => ({
    status: "ready" as const,
    layout: {
      tiles: [
        {
          id: "tile_fake",
          label: "Fake Tile",
          component: () => <div>tile-body</div>,
          viewComponent: () => null,
          worldCol: 26,
          worldRow: 27,
          cols: 4,
          rows: 2,
          home: true,
        },
      ],
      unplaced,
    },
    revision: "rev-1",
    refetch: () => {},
  });

  it("renders the banner with the exact copy when a tile has no space", () => {
    mockLayoutReturn = readyWithTiles(["tile_x"]);
    render(<Board />);

    expect(screen.getByText("New tile has no space — edit layout to place it")).toBeInTheDocument();
  });

  it("does not render the banner when every tile placed", () => {
    mockLayoutReturn = readyWithTiles([]);
    render(<Board />);

    expect(
      screen.queryByText("New tile has no space — edit layout to place it"),
    ).not.toBeInTheDocument();
  });
});
