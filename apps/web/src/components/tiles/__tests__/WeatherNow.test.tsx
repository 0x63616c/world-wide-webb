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
  sunsetIso: "2024-06-01T19:52",
  sunriseIso: "2024-06-01T05:14",
  tomorrowSunriseIso: "2024-06-02T05:15",
  // Solar label/value computed server-side (CC-355t.24)
  solarLabel: "Sunset",
  solarValue: "7:52 PM",
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

    // Metric row values
    expect(screen.getByText("70°")).toBeInTheDocument();
    expect(screen.getByText("58%")).toBeInTheDocument();
    expect(screen.getByText("8 mph")).toBeInTheDocument();
  });

  it("renders skeleton (no temperature text) while loading", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    render(<WeatherNow />);

    // Skeleton shown — title stays visible so the tile is identifiable; only data is shimmered
    expect(screen.getByText("Weather Now")).toBeInTheDocument();

    // Temperature should NOT be rendered
    expect(screen.queryByText(/°$/)).not.toBeInTheDocument();

    // Condition text should NOT appear
    expect(screen.queryByText("Partly Cloudy")).not.toBeInTheDocument();
  });

  it("renders skeleton on error (no placeholder dashes)", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    render(<WeatherNow />);

    // Skeleton shown — no fake dash values
    expect(screen.queryByText("--°")).not.toBeInTheDocument();
    // Title stays visible in the error/retry state so the tile is identifiable
    expect(screen.getByText("Weather Now")).toBeInTheDocument();
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

  it("renders a .tile container (skeleton) on error", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    const { container } = render(<WeatherNow />);

    const tile = container.querySelector(".tile") as HTMLElement;
    expect(tile).toBeInTheDocument();
  });

  // CC-iwi / CC-355t.24: solar event selection is server-side; the component
  // renders whatever solarLabel/solarValue the API returns without re-computing.
  it("shows solarLabel and solarValue from the API response", () => {
    mockUseQuery.mockReturnValue({
      data: { ...SAMPLE_DATA, solarLabel: "Sunset", solarValue: "7:52 PM" },
      isLoading: false,
      isError: false,
    });

    render(<WeatherNow />);

    expect(screen.getByText("Sunset")).toBeInTheDocument();
    expect(screen.getByText("7:52 PM")).toBeInTheDocument();
    expect(screen.queryByText("Sunrise")).not.toBeInTheDocument();
  });

  it("shows Sunrise when the API returns solarLabel=Sunrise", () => {
    mockUseQuery.mockReturnValue({
      data: { ...SAMPLE_DATA, solarLabel: "Sunrise", solarValue: "5:15 AM" },
      isLoading: false,
      isError: false,
    });

    render(<WeatherNow />);

    expect(screen.getByText("Sunrise")).toBeInTheDocument();
    expect(screen.getByText("5:15 AM")).toBeInTheDocument();
    expect(screen.queryByText("Sunset")).not.toBeInTheDocument();
  });

  it("CC-lad: section header uses TileHeader primitive (no local Sec component)", () => {
    mockUseQuery.mockReturnValue({
      data: SAMPLE_DATA,
      isLoading: false,
      isError: false,
    });

    render(<WeatherNow />);

    // TileHeader renders an icon + title span. The title must be present.
    const header = screen.getByText("Weather Now");
    expect(header).toBeInTheDocument();
    // City label still in right slot
    expect(screen.getByText("Los Angeles")).toBeInTheDocument();
  });
});
