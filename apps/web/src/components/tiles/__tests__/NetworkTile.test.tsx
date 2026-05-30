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
// Minimal real-looking traffic data (no sine-wave generation)
// ---------------------------------------------------------------------------

const SAMPLE_TRAFFIC = Array.from({ length: 24 }, (_, i) => ({
  down: i % 3 === 0 ? 0.8 : 0.4,
  up: i % 4 === 0 ? 0.3 : 0.15,
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NetworkTile", () => {
  beforeEach(() => {
    mockUseQuery.mockReset();
  });

  describe("renders with real data", () => {
    test("does not show standalone Online/Offline status word — status is conveyed by StatusDot only", () => {
      mockUseQuery.mockReturnValue({
        data: {
          status: "Online",
          ssid: "HomeNet",
          down: "14.2",
          up: "3.8",
          ping: 12,
          traffic: SAMPLE_TRAFFIC,
        },
        isLoading: false,
        isError: false,
      });

      render(<NetworkTile />);

      // The design (EWifiMirror) never shows the status word as text.
      expect(screen.queryByText("Online")).not.toBeInTheDocument();
    });

    test("renders download and upload GB values", () => {
      mockUseQuery.mockReturnValue({
        data: {
          status: "Online",
          ssid: "HomeNet",
          down: "14.2",
          up: "3.8",
          ping: 12,
          traffic: SAMPLE_TRAFFIC,
        },
        isLoading: false,
        isError: false,
      });

      render(<NetworkTile />);

      expect(screen.getByText(/↓ 14\.2 GB/)).toBeInTheDocument();
      expect(screen.getByText(/↑ 3\.8 GB/)).toBeInTheDocument();
    });

    test("renders ssid only in footer, not next to status", () => {
      mockUseQuery.mockReturnValue({
        data: {
          status: "Online",
          ssid: "HomeNet",
          down: "14.2",
          up: "3.8",
          ping: 12,
          traffic: SAMPLE_TRAFFIC,
        },
        isLoading: false,
        isError: false,
      });

      render(<NetworkTile />);

      // SSID appears exactly once — in the footer only
      const ssidEls = screen.getAllByText("HomeNet");
      expect(ssidEls).toHaveLength(1);
    });

    test("renders ping in footer", () => {
      mockUseQuery.mockReturnValue({
        data: {
          status: "Online",
          ssid: "HomeNet",
          down: "14.2",
          up: "3.8",
          ping: 12,
          traffic: SAMPLE_TRAFFIC,
        },
        isLoading: false,
        isError: false,
      });

      render(<NetworkTile />);

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
          traffic: SAMPLE_TRAFFIC,
        },
        isLoading: false,
        isError: false,
      });

      const { container } = render(<NetworkTile />);

      // Each bucket wrapper is a relative-positioned div with flex:1.
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

    test("renders chart skeleton when traffic array is empty", () => {
      mockUseQuery.mockReturnValue({
        data: {
          status: "Online",
          ssid: "HomeNet",
          down: "14.2",
          up: "3.8",
          ping: 12,
          traffic: [],
        },
        isLoading: false,
        isError: false,
      });

      const { container } = render(<NetworkTile />);

      // No bucket divs should be present — empty traffic renders a Skeleton instead of bars
      const buckets = container.querySelectorAll("[style*='position: relative'][style*='flex: 1']");
      expect(buckets.length).toBe(0);
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

      // Skeleton renders, not invented "Online"
      expect(screen.queryByText("Online")).not.toBeInTheDocument();
    });

    test("does not show Offline text when API returns Offline — status dot handles it", () => {
      mockUseQuery.mockReturnValue({
        data: {
          status: "Offline",
          ssid: "HomeNet",
          down: "0.0",
          up: "0.0",
          ping: 999,
          traffic: [],
        },
        isLoading: false,
        isError: false,
      });

      render(<NetworkTile />);

      // Status conveyed by StatusDot (online={false}), not a text label.
      expect(screen.queryByText("Offline")).not.toBeInTheDocument();
    });
  });
});
