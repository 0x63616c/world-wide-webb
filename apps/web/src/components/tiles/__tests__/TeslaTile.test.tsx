import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TeslaTile } from "../TeslaTile";

// ── Mock tRPC hook ───────────────────────────────────────────────────────────
// We mock the entire trpc module so the component never tries to reach a server.
vi.mock("@/lib/trpc", () => {
  const useQuery = vi.fn();
  return {
    trpc: {
      tesla: {
        get: { useQuery },
      },
    },
    queryClient: {},
    trpcClient: {},
  };
});

// Helper to grab the mock after it has been set up
async function getTeslaUseQuery() {
  const mod = await import("@/lib/trpc");
  return mod.trpc.tesla.get.useQuery as ReturnType<typeof vi.fn>;
}

const MOCK_DATA = {
  name: "Model Y",
  nick: "Evee",
  locked: true,
  place: "Home",
  lat: 34.0537,
  lon: -118.2428,
  charging: true,
  rate: 25,
  pct: 82,
  range: 264,
  odo: "24,113",
  climate: 70,
};

describe("TeslaTile", () => {
  it("renders vehicle data when query succeeds", async () => {
    const useQuery = await getTeslaUseQuery();
    useQuery.mockReturnValue({
      data: MOCK_DATA,
      isLoading: false,
      isError: false,
    });

    const { container } = render(<TeslaTile />);

    // Root element has tile chrome
    expect(container.firstChild).toHaveClass("tile");

    // Header: simplified to just 'Tesla' with lock pill (CC-8c2)
    expect(screen.getByText("Tesla")).toBeInTheDocument();
    expect(screen.queryByText("MODEL Y")).not.toBeInTheDocument();
    expect(screen.queryByText(/Tesla · Home/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Evee")).not.toBeInTheDocument();
    expect(screen.getByText("Locked")).toBeInTheDocument();

    // Map labels
    expect(screen.getByText("a local street")).toBeInTheDocument();
    expect(screen.getByText(/Parked · Home/i)).toBeInTheDocument();

    // Charging bar
    expect(screen.getByText(/Charging/i)).toBeInTheDocument();
    expect(screen.getByText("+25 mi/hr", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();

    // Stats
    expect(screen.getByText("264 mi")).toBeInTheDocument();
    expect(screen.getByText("24,113")).toBeInTheDocument();
    expect(screen.getByText("70°F")).toBeInTheDocument();
  });

  it("renders unlocked state with amber pill when car is unlocked", async () => {
    const useQuery = await getTeslaUseQuery();
    useQuery.mockReturnValue({
      data: { ...MOCK_DATA, locked: false },
      isLoading: false,
      isError: false,
    });

    render(<TeslaTile />);
    expect(screen.getByText("Unlocked")).toBeInTheDocument();
    // pill should have amber class
    const pill = screen.getByText("Unlocked").closest(".pill");
    expect(pill).toHaveClass("amber");
  });

  it("renders skeleton (no fake data) while loading", async () => {
    const useQuery = await getTeslaUseQuery();
    useQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    render(<TeslaTile />);

    // Real data must NOT be rendered — skeleton shows instead
    expect(screen.queryByText("82%")).not.toBeInTheDocument();
    expect(screen.queryByText("264 mi")).not.toBeInTheDocument();
  });

  it("renders skeleton on error (no fake data)", async () => {
    const useQuery = await getTeslaUseQuery();
    useQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    render(<TeslaTile />);

    // Real data must NOT be rendered
    expect(screen.queryByText("264 mi")).not.toBeInTheDocument();
  });

  it("CC-lad: stat rows use shared Stat primitive (data-stat-value attribute present)", async () => {
    const useQuery = await getTeslaUseQuery();
    useQuery.mockReturnValue({
      data: MOCK_DATA,
      isLoading: false,
      isError: false,
    });

    const { container } = render(<TeslaTile />);
    // Shared Stat component renders spans with data-stat-value attribute
    const statValues = container.querySelectorAll("[data-stat-value]");
    expect(statValues.length).toBeGreaterThanOrEqual(3);
  });

  it("shows Idle pill when not charging", async () => {
    const useQuery = await getTeslaUseQuery();
    useQuery.mockReturnValue({
      data: { ...MOCK_DATA, charging: false, rate: 0 },
      isLoading: false,
      isError: false,
    });

    render(<TeslaTile />);
    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(screen.queryByText(/Charging/i)).not.toBeInTheDocument();
  });
});
