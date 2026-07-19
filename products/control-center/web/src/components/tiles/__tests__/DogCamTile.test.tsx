import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the trpc module so no real HTTP is made in tests.
// We expose a replaceable spy for camera.info.useQuery.
const mockUseQuery = vi.fn();

vi.mock("../../../lib/trpc", () => ({
  trpc: {
    camera: {
      info: {
        useQuery: (...args: unknown[]) => mockUseQuery(...args),
      },
    },
  },
}));

// The face opens the full-page detail via the tile-detail store , spy on it.
const mockOpenTileDetail = vi.fn();
vi.mock("../../../lib/tile-detail-store", () => ({
  openTileDetail: (...args: unknown[]) => mockOpenTileDetail(...args),
}));

// Import AFTER the mocks are registered.
import { DogCamTile } from "../DogCamTile";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Helpers
function renderWithData(overrides?: {
  data?: Partial<{
    label: string;
    online: boolean;
    snapshotUrl: string | null;
    streamUrl: string | null;
    entityId: string | null;
  }>;
  isLoading?: boolean;
  isError?: boolean;
}) {
  const defaults = {
    label: "Living Room",
    online: true,
    snapshotUrl: null,
    streamUrl: null,
    entityId: "camera.living_room",
  };
  mockUseQuery.mockReturnValue({
    data: overrides?.data !== undefined ? { ...defaults, ...overrides.data } : defaults,
    isLoading: overrides?.isLoading ?? false,
    isError: overrides?.isError ?? false,
  });
  return render(<DogCamTile />);
}

describe("DogCamTile", () => {
  describe("section header", () => {
    it("renders the 'Living Room Cam' section header", () => {
      renderWithData();
      expect(screen.getByText("Living Room Cam")).toBeDefined();
    });

    it("tile wrapper has padding 22", () => {
      const { container } = renderWithData();
      const tile = container.firstChild as HTMLElement;
      expect(tile.style.padding).toBe("22px");
    });
  });

  describe("covered state (always, on the face)", () => {
    it("renders the frosted cover with cam icon, label, and tap prompt", () => {
      renderWithData();
      expect(screen.getByText("Living Room")).toBeDefined();
      expect(screen.getByText(/tap to view feed/i)).toBeDefined();
    });

    it("uses data label from camera.info", () => {
      renderWithData({ data: { label: "Backyard Cam" } });
      expect(screen.getByText("Backyard Cam")).toBeDefined();
    });

    it("renders skeleton (no label text) when data is undefined", () => {
      mockUseQuery.mockReturnValue({ data: undefined, isLoading: false, isError: false });
      render(<DogCamTile />);
      // No hardcoded label should appear; skeleton placeholder is rendered instead
      expect(screen.queryByText("Living Room")).toBeNull();
    });

    it("shows 'Camera offline' when camera is not online", () => {
      renderWithData({ data: { online: false } });
      expect(screen.getByText(/camera offline/i)).toBeDefined();
    });

    it("never renders LIVE/REC on the face , the live feed lives on the detail page", () => {
      renderWithData({ data: { streamUrl: "/media/camera-stream" } });
      expect(screen.queryByText("LIVE")).toBeNull();
      expect(screen.queryByText(/^REC /)).toBeNull();
    });
  });

  describe("loading state", () => {
    it("renders loading cover without label text when isLoading", () => {
      mockUseQuery.mockReturnValue({ data: undefined, isLoading: true, isError: false });
      render(<DogCamTile />);
      const feedEl = screen.getByRole("button");
      expect(feedEl).toBeDefined();
    });
  });

  describe("snapshot image", () => {
    it("renders img with snapshotUrl when provided", () => {
      renderWithData({ data: { snapshotUrl: "http://ha.local/cam.jpg" } });
      const img = screen.getByRole("img");
      expect((img as HTMLImageElement).src).toContain("cam.jpg");
    });

    it("renders no img when snapshotUrl is null", () => {
      renderWithData({ data: { snapshotUrl: null } });
      expect(screen.queryByRole("img")).toBeNull();
    });
  });

  describe("tap surface", () => {
    it("tapping the feed opens the full-page detail instead of toggling inline", () => {
      renderWithData({ data: { streamUrl: "/media/camera-stream" } });

      fireEvent.click(screen.getByRole("button"));

      expect(mockOpenTileDetail).toHaveBeenCalledWith("tile_dogcam");
      // The face stays covered , no inline stream, no LIVE chrome.
      expect(screen.queryByText("LIVE")).toBeNull();
      expect(screen.getByText(/tap to view feed/i)).toBeDefined();
    });
  });
});
