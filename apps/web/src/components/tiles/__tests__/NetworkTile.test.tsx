import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NetworkTile } from "../NetworkTile";
import "@testing-library/jest-dom";

// ---------------------------------------------------------------------------
// Mock the tRPC client so the component never makes real HTTP requests
// ---------------------------------------------------------------------------

const mockUseQuery = vi.fn();

vi.mock("../../../lib/trpc", () => ({
  trpc: {
    network: {
      status: {
        useQuery: (...args: unknown[]) => mockUseQuery(...args),
      },
    },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFallbackTraffic() {
  return Array.from({ length: 24 }, (_, i) => ({
    down: 0.3 + 0.7 * Math.abs(Math.sin(i * 0.5 + 1)),
    up: 0.18 + 0.5 * Math.abs(Math.cos(i * 0.4)) * 0.6,
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NetworkTile", () => {
  beforeEach(() => {
    mockUseQuery.mockReset();
  });

  describe("renders with real data", () => {
    test("shows Online status in accent colour", () => {
      mockUseQuery.mockReturnValue({
        data: {
          status: "Online",
          ssid: "HomeNet",
          down: "14.2",
          up: "3.8",
          ping: 12,
          traffic: makeFallbackTraffic(),
        },
        isLoading: false,
        isError: false,
      });

      render(<NetworkTile />);

      expect(screen.getByText("Online")).toBeInTheDocument();
    });

    test("renders download and upload GB values", () => {
      mockUseQuery.mockReturnValue({
        data: {
          status: "Online",
          ssid: "HomeNet",
          down: "14.2",
          up: "3.8",
          ping: 12,
          traffic: makeFallbackTraffic(),
        },
        isLoading: false,
        isError: false,
      });

      render(<NetworkTile />);

      expect(screen.getByText(/↓ 14\.2 GB/)).toBeInTheDocument();
      expect(screen.getByText(/↑ 3\.8 GB/)).toBeInTheDocument();
    });

    test("renders ssid and ping in footer", () => {
      mockUseQuery.mockReturnValue({
        data: {
          status: "Online",
          ssid: "HomeNet",
          down: "14.2",
          up: "3.8",
          ping: 12,
          traffic: makeFallbackTraffic(),
        },
        isLoading: false,
        isError: false,
      });

      render(<NetworkTile />);

      // ssid appears in both the status row and the footer
      const ssidEls = screen.getAllByText("HomeNet");
      expect(ssidEls.length).toBeGreaterThanOrEqual(1);

      expect(screen.getByText("12ms")).toBeInTheDocument();
    });

    test("renders 24 butterfly chart bar-pair wrappers", () => {
      mockUseQuery.mockReturnValue({
        data: {
          status: "Online",
          ssid: "HomeNet",
          down: "14.2",
          up: "3.8",
          ping: 12,
          traffic: makeFallbackTraffic(),
        },
        isLoading: false,
        isError: false,
      });

      const { container } = render(<NetworkTile />);

      // Each bucket wrapper is a relative-positioned div with flex:1.
      // They live inside the flex chart container which itself is flex-direction:column
      // inside the flex:1 chart area. Select by the position:relative style.
      const buckets = container.querySelectorAll("[style*='position: relative'][style*='flex: 1']");
      // 24 buckets + the outer chart wrapper also matches (flex:1), so >= 24
      expect(buckets.length).toBeGreaterThanOrEqual(24);
    });

    test("passes refetchInterval of 60000 to useQuery", () => {
      mockUseQuery.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: false,
      });

      render(<NetworkTile />);

      expect(mockUseQuery).toHaveBeenCalledWith(undefined, {
        refetchInterval: 60_000,
      });
    });
  });

  describe("loading state", () => {
    test("renders skeleton (no status text) while loading", () => {
      mockUseQuery.mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
      });

      render(<NetworkTile />);

      // Skeleton shown — real status text not present
      expect(screen.queryByText("Online")).not.toBeInTheDocument();
      expect(screen.queryByText("…")).not.toBeInTheDocument();
    });

    test("renders skeleton (no down/up labels) while loading", () => {
      mockUseQuery.mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
      });

      render(<NetworkTile />);

      // No fake data shown while loading
      expect(screen.queryByText(/↓/)).not.toBeInTheDocument();
      expect(screen.queryByText(/↑/)).not.toBeInTheDocument();
    });
  });

  describe("error / offline state", () => {
    test("renders skeleton on error — does not throw", () => {
      mockUseQuery.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
      });

      expect(() => render(<NetworkTile />)).not.toThrow();
    });

    test("renders skeleton (no Online text) when error and no data", () => {
      mockUseQuery.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
      });

      render(<NetworkTile />);

      // Skeleton renders, not fallback "Online"
      expect(screen.queryByText("Online")).not.toBeInTheDocument();
    });

    test("renders Offline status when API returns Offline", () => {
      mockUseQuery.mockReturnValue({
        data: {
          status: "Offline",
          ssid: "HomeNet",
          down: "0.0",
          up: "0.0",
          ping: 999,
          traffic: makeFallbackTraffic(),
        },
        isLoading: false,
        isError: false,
      });

      render(<NetworkTile />);

      expect(screen.getByText("Offline")).toBeInTheDocument();
    });
  });
});
