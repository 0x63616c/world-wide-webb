/**
 * Tests for useBoardLayout. Strategy mirrors ControlsTile.test.tsx (mock
 * `../lib/trpc`'s `useQuery` directly, so no real tRPC/React-Query setup is
 * needed) combined with useIdleReset.test.tsx's renderHook pattern (drive the
 * hook directly, not through Board).
 *
 * Covers the doc-comment's two contracts:
 *  - Blocking first paint: status stays "loading" until the first attempt
 *    settles (success or error), then "ready" forever after.
 *  - Revision-gated apply: a query result whose revision matches what's
 *    already applied is a no-op (same layout object identity); a changed
 *    revision re-resolves.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// resolveLayout's default registry param reads TILE_REGISTRY, which
// transitively imports TeslaTile → MapLibre. MapLibre calls
// window.URL.createObjectURL at import time, which jsdom lacks , stub it the
// same way board-layout.test.ts does.
vi.mock("maplibre-gl", () => ({
  default: {
    Map: vi.fn(() => ({
      addControl: vi.fn(),
      on: vi.fn(),
      remove: vi.fn(),
      setCenter: vi.fn(),
      easeTo: vi.fn(),
    })),
    Marker: vi.fn(() => ({
      setLngLat: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      remove: vi.fn().mockReturnThis(),
      getElement: vi.fn().mockReturnValue(document.createElement("div")),
    })),
    NavigationControl: vi.fn(),
    addProtocol: vi.fn(),
    removeProtocol: vi.fn(),
  },
}));
vi.mock("pmtiles", () => ({ Protocol: vi.fn().mockImplementation(() => ({ tile: vi.fn() })) }));
vi.mock("@protomaps/basemaps", () => ({
  layers: vi.fn().mockReturnValue([]),
  namedFlavor: vi.fn().mockReturnValue({}),
}));

type MockQueryReturn = {
  data:
    | {
        placements: { tileId: string; worldCol: number; worldRow: number }[];
        revision: string | null;
      }
    | undefined;
  isSuccess: boolean;
  isError: boolean;
};

let mockQueryReturn: MockQueryReturn = {
  data: undefined,
  isSuccess: false,
  isError: false,
};
const mockRefetch = vi.fn();
const mockUseQuery = vi.fn((_input: unknown, options: { enabled?: boolean }) => ({
  ...mockQueryReturn,
  refetch: mockRefetch,
  __options: options,
}));

vi.mock("./trpc", () => ({
  trpc: {
    layout: {
      get: {
        useQuery: (input: unknown, options: { enabled?: boolean }) => mockUseQuery(input, options),
      },
    },
  },
}));

// Import after the mock above (vi.mock is hoisted), matching the ControlsTile
// precedent.
import { useBoardLayout } from "./useBoardLayout";

afterEach(() => {
  vi.clearAllMocks();
  mockQueryReturn = { data: undefined, isSuccess: false, isError: false };
});

describe("useBoardLayout", () => {
  it("stays loading before the first query attempt settles", () => {
    mockQueryReturn = { data: undefined, isSuccess: false, isError: false };
    const { result } = renderHook(() => useBoardLayout());
    expect(result.current.status).toBe("loading");
  });

  it("first success applies the resolved layout and flips to ready", () => {
    mockQueryReturn = {
      data: {
        placements: [{ tileId: "tile_clock", worldCol: 10, worldRow: 12 }],
        revision: "rev-1",
      },
      isSuccess: true,
      isError: false,
    };
    const { result, rerender } = renderHook(() => useBoardLayout());
    rerender();

    expect(result.current.status).toBe("ready");
    expect(result.current.revision).toBe("rev-1");
    // The saved placement must actually be reflected , find the tile by id.
    const clock = result.current.layout.tiles.find((t) => t.id === "tile_clock");
    expect(clock?.worldCol).toBe(10);
    expect(clock?.worldRow).toBe(12);
  });

  it("first success with revision: null still applies (distinct from 'nothing applied yet')", () => {
    mockQueryReturn = {
      data: { placements: [], revision: null },
      isSuccess: true,
      isError: false,
    };
    const { result, rerender } = renderHook(() => useBoardLayout());
    rerender();

    expect(result.current.status).toBe("ready");
    expect(result.current.revision).toBeNull();
  });

  it("error settles status to ready with the registry-defaults layout (resolveLayout([]))", () => {
    mockQueryReturn = { data: undefined, isSuccess: false, isError: true };
    const { result, rerender } = renderHook(() => useBoardLayout());
    rerender();

    expect(result.current.status).toBe("ready");
    expect(result.current.revision).toBeNull();
    // No saved placements applied , every tile sits at its registry default,
    // i.e. the layout is whatever resolveLayout([]) produces.
    expect(result.current.layout.unplaced).toEqual([]);
  });

  it("a refetch returning the SAME revision does not produce a new layout object", () => {
    mockQueryReturn = {
      data: {
        placements: [{ tileId: "tile_clock", worldCol: 10, worldRow: 12 }],
        revision: "rev-1",
      },
      isSuccess: true,
      isError: false,
    };
    const { result, rerender } = renderHook(() => useBoardLayout());
    rerender();
    const firstLayout = result.current.layout;

    // Poll returns fresh data (new placements array instance) but the SAME
    // revision , the applied layout must be the identical object, not re-resolved.
    mockQueryReturn = {
      data: {
        placements: [{ tileId: "tile_clock", worldCol: 99, worldRow: 99 }],
        revision: "rev-1",
      },
      isSuccess: true,
      isError: false,
    };
    rerender();

    expect(result.current.layout).toBe(firstLayout);
    const clock = result.current.layout.tiles.find((t) => t.id === "tile_clock");
    expect(clock?.worldCol).toBe(10);
  });

  it("a refetch returning a CHANGED revision re-resolves the layout", () => {
    mockQueryReturn = {
      data: {
        placements: [{ tileId: "tile_clock", worldCol: 10, worldRow: 12 }],
        revision: "rev-1",
      },
      isSuccess: true,
      isError: false,
    };
    const { result, rerender } = renderHook(() => useBoardLayout());
    rerender();
    const firstLayout = result.current.layout;

    mockQueryReturn = {
      data: {
        placements: [{ tileId: "tile_clock", worldCol: 30, worldRow: 31 }],
        revision: "rev-2",
      },
      isSuccess: true,
      isError: false,
    };
    rerender();

    expect(result.current.layout).not.toBe(firstLayout);
    expect(result.current.revision).toBe("rev-2");
    const clock = result.current.layout.tiles.find((t) => t.id === "tile_clock");
    expect(clock?.worldCol).toBe(30);
    expect(clock?.worldRow).toBe(31);
  });

  it("refetch() delegates to the underlying query's refetch", () => {
    mockQueryReturn = { data: undefined, isSuccess: false, isError: false };
    const { result } = renderHook(() => useBoardLayout());
    result.current.refetch();
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("defaults the query to enabled when called with no options (every pre-existing call site)", () => {
    renderHook(() => useBoardLayout());
    expect(mockUseQuery).toHaveBeenLastCalledWith(
      undefined,
      expect.objectContaining({ enabled: true }),
    );
  });

  it("forwards enabled: false to the query (e.g. while the layout editor is open)", () => {
    renderHook(() => useBoardLayout({ enabled: false }));
    expect(mockUseQuery).toHaveBeenLastCalledWith(
      undefined,
      expect.objectContaining({ enabled: false }),
    );
  });
});
