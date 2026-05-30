/**
 * WeatherNow tile — component tests.
 * Mocks the trpc hook so no network calls are made.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WeatherNow } from "../WeatherNow";

// ---------------------------------------------------------------------------
// Mock the entire trpc module so we can control hook return values per test.
// ---------------------------------------------------------------------------
const mockUseQuery = vi.fn();

vi.mock("../../../lib/trpc", () => ({
  trpc: {
    weather: {
      now: {
        useQuery: (...args: unknown[]) => mockUseQuery(...args),
      },
    },
  },
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const SAMPLE_DATA = {
  temp: 72.4,
  cond: "Partly Cloudy",
  hi: 78.1,
  lo: 64.5,
  feels: 70.2,
  hum: 58,
  wind: 8.3,
  sunset: "7:52 PM",
  city: "Los Angeles",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("WeatherNow", () => {
  beforeEach(() => {
    mockUseQuery.mockReset();
  });

  it("renders weather data correctly when query succeeds", () => {
    mockUseQuery.mockReturnValue({
      data: SAMPLE_DATA,
      isLoading: false,
      isError: false,
    });

    render(<WeatherNow />);

    // Section header
    expect(screen.getByText("Weather Now")).toBeInTheDocument();

    // City cap label
    expect(screen.getByText("Los Angeles")).toBeInTheDocument();

    // Temperature (rounded)
    expect(screen.getByText("72°")).toBeInTheDocument();

    // Condition
    expect(screen.getByText("Partly Cloudy")).toBeInTheDocument();

    // Hi/Lo
    expect(screen.getByText("H 78°")).toBeInTheDocument();
    expect(screen.getByText("L 65°")).toBeInTheDocument();

    // Metric row labels
    expect(screen.getByText("Feels")).toBeInTheDocument();
    expect(screen.getByText("Humidity")).toBeInTheDocument();
    expect(screen.getByText("Wind")).toBeInTheDocument();
    expect(screen.getByText("Sunset")).toBeInTheDocument();

    // Metric row values
    expect(screen.getByText("70°")).toBeInTheDocument();
    expect(screen.getByText("58%")).toBeInTheDocument();
    expect(screen.getByText("8 mph")).toBeInTheDocument();
    expect(screen.getByText("7:52 PM")).toBeInTheDocument();
  });

  it("shows a skeleton while loading and does not render temperature", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    render(<WeatherNow />);

    // Header is still visible
    expect(screen.getByText("Weather Now")).toBeInTheDocument();

    // Temperature should NOT be rendered
    expect(screen.queryByText(/°$/)).not.toBeInTheDocument();

    // Condition text should NOT appear
    expect(screen.queryByText("Partly Cloudy")).not.toBeInTheDocument();
  });

  it("renders graceful fallback placeholder values on error (never blank)", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    render(<WeatherNow />);

    // Header still present
    expect(screen.getByText("Weather Now")).toBeInTheDocument();

    // Placeholder dashes displayed instead of blank.
    // The main temp renders as two text nodes ("--" + "°") inside one element;
    // the feels metric row also renders "--°" as a single string. Use getAllByText.
    const tempDashes = screen.getAllByText("--°");
    expect(tempDashes.length).toBeGreaterThanOrEqual(1);

    // Placeholder city
    expect(screen.getByText("Los Angeles")).toBeInTheDocument();
  });

  it("passes refetchInterval 10 minutes to useQuery", () => {
    mockUseQuery.mockReturnValue({
      data: SAMPLE_DATA,
      isLoading: false,
      isError: false,
    });

    render(<WeatherNow />);

    expect(mockUseQuery).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ refetchInterval: 10 * 60 * 1000 }),
    );
  });

  it("dims the tile on error when no cached data exists", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    const { container } = render(<WeatherNow />);

    const tile = container.querySelector(".tile") as HTMLElement;
    expect(tile).toBeInTheDocument();
    expect(tile.style.opacity).toBe("0.55");
  });
});
