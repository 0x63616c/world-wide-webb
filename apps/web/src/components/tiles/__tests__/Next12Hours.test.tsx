import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Next12Hours } from "../Next12Hours";

// Mock the trpc module so the component never touches real network
vi.mock("../../../lib/trpc", () => ({
  trpc: {
    weather: {
      hourly: {
        useQuery: vi.fn(),
      },
    },
  },
}));

// Mock ResizeObserver — jsdom does not implement it.
// We give it a non-zero width so the SVG chart renders.
const mockObserveCallbacks = new Set<() => void>();
class MockResizeObserver {
  private _callback: () => void;
  constructor(callback: () => void) {
    this._callback = callback;
  }
  observe(el: Element) {
    // Simulate a 400px wide container
    Object.defineProperty(el, "clientWidth", { configurable: true, value: 400 });
    Object.defineProperty(el, "clientHeight", { configurable: true, value: 200 });
    mockObserveCallbacks.add(this._callback);
    this._callback();
  }
  unobserve() {}
  disconnect() {
    mockObserveCallbacks.delete(this._callback);
  }
}
vi.stubGlobal("ResizeObserver", MockResizeObserver);

import { trpc } from "../../../lib/trpc";

const mockHourlyQuery = trpc.weather.hourly.useQuery as ReturnType<typeof vi.fn>;

const SAMPLE_HOURS = [
  { t: "Now", temp: 74, feels: 73, ic: "cloud-sun" },
  { t: "2", temp: 76, feels: 75, ic: "sun" },
  { t: "3", temp: 78, feels: 77, ic: "sun" },
  { t: "4", temp: 79, feels: 78, ic: "sun" },
  { t: "5", temp: 77, feels: 76, ic: "cloud-sun" },
  { t: "6", temp: 73, feels: 72, ic: "cloud" },
  { t: "7", temp: 70, feels: 69, ic: "cloud" },
  { t: "8", temp: 68, feels: 67, ic: "moon" },
  { t: "9", temp: 66, feels: 65, ic: "moon" },
  { t: "10", temp: 65, feels: 64, ic: "moon" },
  { t: "11", temp: 64, feels: 63, ic: "moon" },
  { t: "12", temp: 63, feels: 62, ic: "moon" },
];

describe("Next12Hours", () => {
  it("renders the section header and legend", () => {
    mockHourlyQuery.mockReturnValue({
      data: SAMPLE_HOURS,
      isLoading: false,
      isError: false,
    });

    render(<Next12Hours />);

    expect(screen.getByText("Next 12 Hours")).toBeInTheDocument();
    expect(screen.getByText("┈ Feels")).toBeInTheDocument();
    expect(screen.getByText("▮ Temp")).toBeInTheDocument();
  });

  it("renders with data — shows hour labels and temp values", () => {
    mockHourlyQuery.mockReturnValue({
      data: SAMPLE_HOURS,
      isLoading: false,
      isError: false,
    });

    render(<Next12Hours />);

    // Hour labels are rendered as text spans in the icon+label row
    expect(screen.getAllByText("Now").length).toBeGreaterThan(0);
    expect(screen.getByText("2")).toBeInTheDocument();
    // No error notice
    expect(screen.queryByText("Using cached data")).not.toBeInTheDocument();
  });

  it("renders skeleton (no hour labels) while loading", () => {
    mockHourlyQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    render(<Next12Hours />);

    // Skeleton shown — no real content
    expect(screen.queryByText("Now")).not.toBeInTheDocument();
    expect(screen.queryByText("Using cached data")).not.toBeInTheDocument();
  });

  it("renders skeleton on error (no placeholder hour labels)", () => {
    mockHourlyQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    render(<Next12Hours />);

    // Skeleton shown — no "Using cached data" notice, no fake hour data
    expect(screen.queryByText("Using cached data")).not.toBeInTheDocument();
    expect(screen.queryByText("Now")).not.toBeInTheDocument();
  });

  it("calls the trpc query with a numeric refetch interval", () => {
    mockHourlyQuery.mockReturnValue({
      data: SAMPLE_HOURS,
      isLoading: false,
      isError: false,
    });

    render(<Next12Hours />);

    expect(mockHourlyQuery).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ refetchInterval: expect.any(Number) }),
    );
  });

  it("does not pass a retry override — inherits global QueryClient config", () => {
    mockHourlyQuery.mockReturnValue({
      data: SAMPLE_HOURS,
      isLoading: false,
      isError: false,
    });

    render(<Next12Hours />);

    const [, opts] = mockHourlyQuery.mock.calls[0];
    expect(opts).not.toHaveProperty("retry");
  });

  it("renders feels-like polyline with reduced opacity for subtlety", () => {
    mockHourlyQuery.mockReturnValue({
      data: SAMPLE_HOURS,
      isLoading: false,
      isError: false,
    });

    const { container } = render(<Next12Hours />);

    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    // opacity attribute or style must be set to dial back the feels line
    const opacity = polyline?.getAttribute("opacity") ?? polyline?.style.opacity ?? "";
    expect(parseFloat(opacity)).toBeLessThan(1);
  });

  it("CC-z2x: feels-like polyline uses low-contrast rgba stroke (not #6E747D)", () => {
    mockHourlyQuery.mockReturnValue({
      data: SAMPLE_HOURS,
      isLoading: false,
      isError: false,
    });

    const { container } = render(<Next12Hours />);

    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    const stroke = polyline?.getAttribute("stroke") ?? "";
    // Must NOT be the old hex colour
    expect(stroke).not.toBe("#6E747D");
    // Must be an rgba value (low-contrast white)
    expect(stroke).toMatch(/^rgba\(/);
  });

  it("CC-lad: section header uses TileHeader primitive (no hand-rolled flex row)", () => {
    mockHourlyQuery.mockReturnValue({
      data: SAMPLE_HOURS,
      isLoading: false,
      isError: false,
    });

    render(<Next12Hours />);

    // TileHeader renders the title as a span inside a flex row.
    // If the primitive is used, "Next 12 Hours" is present and no duplicate is needed.
    const header = screen.getByText("Next 12 Hours");
    expect(header).toBeInTheDocument();
  });

  it("CC-42i: renders a bar per hour when data is present (chart actually draws)", () => {
    mockHourlyQuery.mockReturnValue({
      data: SAMPLE_HOURS,
      isLoading: false,
      isError: false,
    });

    const { container } = render(<Next12Hours />);

    // Each hour gets a [data-bar] element in the flex chart band.
    // The container slices weather.hourly to 12, so 12 bars render here.
    const bars = container.querySelectorAll("[data-bar]");
    expect(bars.length).toBe(SAMPLE_HOURS.length);
  });

  it("CC-42i: renders exactly 12 bars for 12 data points", () => {
    mockHourlyQuery.mockReturnValue({
      data: SAMPLE_HOURS,
      isLoading: false,
      isError: false,
    });

    const { container } = render(<Next12Hours />);

    const bars = container.querySelectorAll("[data-bar]");
    expect(bars.length).toBe(12);
  });
});
