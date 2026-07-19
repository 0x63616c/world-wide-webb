import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// A fake one-tile registry so Board can be exercised without loading real tiles
// (or their transitive deps like maplibre-gl) in jsdom. The fake tile renders an
// inner button so we can prove control taps don't open the detail page.
vi.mock("../../lib/tile-registry", () => {
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
  };
  return { TILE_REGISTRY: [fake], HOME_TILE: fake };
});
// Board now reads its layout via useBoardLayout (tRPC), which needs a real
// TRPCProvider the plain jsdom render here doesn't set up. Stub it to settle
// immediately on the fake registry above, mirroring the real resolveLayout([])
// (no saved placements) path , same shape a fresh/empty deployment sees.
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

// Fake detail registry: tile_fake opens a single-variant full page. Mocking it
// also keeps jsdom clear of the real tile wiring (and transitively maplibre-gl).
vi.mock("../tiles/detail/registry", () => ({
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
}));

import { BUILD_HASH } from "../../config/build";
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

  it("renders the pannable #world inside #stage", () => {
    render(<Board />);
    const stage = document.getElementById("stage");
    const world = document.getElementById("world");
    expect(world).not.toBeNull();
    expect(stage?.contains(world ?? null)).toBe(true);
  });

  it("tapping a tile opens its detail page", () => {
    render(<Board />);
    expect(screen.queryByTestId("fake-detail")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Fake Tile" }));

    expect(screen.getByTestId("fake-detail").textContent).toContain("fake-detail-content");
  });

  it("tapping an inner control does NOT open the detail page", () => {
    render(<Board />);
    fireEvent.click(screen.getByRole("button", { name: "inner-control" }));
    expect(screen.queryByTestId("fake-detail")).toBeNull();
  });

  it("renders the build-hash badge from the build config, prefixed with #", () => {
    render(<Board />);
    // No vite `define` in the test env, so BUILD_HASH falls back to "dev" and
    // BUILD_TIME is NaN (no age shown); the badge renders the '#'-prefixed SHA.
    expect(BUILD_HASH).toBe("dev");
    expect(screen.getByText(`#${BUILD_HASH.slice(0, 7)}`)).toBeTruthy();
  });
});
