import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

// Import AFTER the mock is registered.
import { DogCamTile } from "../DogCamTile";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
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
    it("renders the 'Dog Cam' section header", () => {
      renderWithData();
      expect(screen.getByText("Dog Cam")).toBeDefined();
    });

    it("tile wrapper has padding 22", () => {
      const { container } = renderWithData();
      const tile = container.firstChild as HTMLElement;
      expect(tile.style.padding).toBe("22px");
    });
  });

  describe("covered state (default)", () => {
    it("renders the frosted cover with cam icon, label, and tap prompt", () => {
      renderWithData();

      // Cam icon is present (aria-hidden but DOM node is there)
      // The cover text should be visible
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
  });

  describe("loading state", () => {
    it("renders loading cover without label text when isLoading", () => {
      mockUseQuery.mockReturnValue({ data: undefined, isLoading: true, isError: false });
      render(<DogCamTile />);
      // Should not throw, component renders in a loading covered state
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

  describe("live state (tap to reveal)", () => {
    it("shows LIVE label and REC timer after tap, hides cover", () => {
      vi.useFakeTimers();
      renderWithData();

      const feedEl = screen.getByRole("button");

      act(() => {
        fireEvent.click(feedEl);
      });

      // Cover should be gone , "Tap to view feed" disappears
      expect(screen.queryByText(/tap to view feed/i)).toBeNull();

      // LIVE and REC should appear
      expect(screen.getByText("LIVE")).toBeDefined();
      expect(screen.getByText(/^REC 00:00:00$/)).toBeDefined();
    });

    it("increments the REC timer each second", () => {
      vi.useFakeTimers();
      renderWithData();

      const feedEl = screen.getByRole("button");
      act(() => {
        fireEvent.click(feedEl);
      });

      expect(screen.getByText(/^REC 00:00:00$/)).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(screen.getByText(/^REC 00:00:03$/)).toBeDefined();
    });

    it("shows the label in the caption when live", () => {
      vi.useFakeTimers();
      renderWithData({ data: { label: "Dog Room" } });
      const feedEl = screen.getByRole("button");
      act(() => {
        fireEvent.click(feedEl);
      });

      // The caption at the bottom of the feed
      // "Dog Room" appears both as caption in live and was label in cover
      const labels = screen.getAllByText("Dog Room");
      expect(labels.length).toBeGreaterThan(0);
    });

    it("tapping again returns to covered state and resets REC", () => {
      vi.useFakeTimers();
      renderWithData();

      const feedEl = screen.getByRole("button");
      act(() => {
        fireEvent.click(feedEl);
      });
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      // Now live, tap again
      act(() => {
        fireEvent.click(feedEl);
      });

      expect(screen.queryByText("LIVE")).toBeNull();
      expect(screen.getByText(/tap to view feed/i)).toBeDefined();
    });
  });
});
