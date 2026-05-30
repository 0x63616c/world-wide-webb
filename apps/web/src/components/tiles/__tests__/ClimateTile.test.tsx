import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { ClimateTile } from "../ClimateTile";

// ── Mock the tRPC hooks ──────────────────────────────────────────────────────
// We mock at the module level so the component never touches the network.

const mockSetTargetMutate = vi.fn();
const mockSetModeMutate = vi.fn();

const mockUseQuery = vi.fn();
const mockUseSetTargetMutation = vi.fn(() => ({ mutate: mockSetTargetMutate }));
const mockUseSetModeMutation = vi.fn(() => ({ mutate: mockSetModeMutate }));

vi.mock("../../../lib/trpc", () => ({
  trpc: {
    climate: {
      get: {
        useQuery: (...args: unknown[]) => mockUseQuery(...args),
      },
      setTarget: {
        useMutation: (...args: unknown[]) => mockUseSetTargetMutation(...args),
      },
      setMode: {
        useMutation: (...args: unknown[]) => mockUseSetModeMutation(...args),
      },
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderTile() {
  return render(<ClimateTile />);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ClimateTile — renders with data", () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue({
      data: { target: 68, ambient: 72, mode: "cool", action: "Cooling" },
      isLoading: false,
      isError: false,
    });
  });

  it("shows the setpoint temperature from server data", () => {
    renderTile();
    // setpoint text node contains "68"
    expect(screen.getByTestId("setpoint")).toHaveTextContent("68");
  });

  it("displays the °F suffix", () => {
    renderTile();
    expect(screen.getByTestId("setpoint")).toHaveTextContent("°F");
  });

  it("shows the mode pill label for Cooling", () => {
    renderTile();
    expect(screen.getByText("Cooling")).toBeInTheDocument();
  });

  it("marks the Cool chip as active", () => {
    renderTile();
    expect(screen.getByTestId("chip-cool")).toHaveClass("on");
  });

  it("shows ambient temperature marker", () => {
    renderTile();
    expect(screen.getByTestId("ambient-label")).toHaveTextContent("72°");
  });

  it("renders 65° and 80° end labels", () => {
    renderTile();
    expect(screen.getByText("65°")).toBeInTheDocument();
    expect(screen.getByText("80°")).toBeInTheDocument();
  });

  it("sets slider value to target", () => {
    renderTile();
    const slider = screen.getByTestId("slider") as HTMLInputElement;
    expect(slider.value).toBe("68");
  });
});

describe("ClimateTile — loading state (no data yet)", () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
  });

  it("renders skeleton (no setpoint) while loading", () => {
    renderTile();
    // Skeleton shown — real setpoint must not be present
    expect(screen.queryByTestId("setpoint")).not.toBeInTheDocument();
  });

  it("renders skeleton (no slider) while loading", () => {
    renderTile();
    expect(screen.queryByTestId("slider")).not.toBeInTheDocument();
  });
});

describe("ClimateTile — error state", () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
  });

  it("renders skeleton without crashing when error and no data", () => {
    renderTile();
    expect(screen.queryByTestId("setpoint")).not.toBeInTheDocument();
  });
});

describe("ClimateTile — chip interaction", () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue({
      data: { target: 70, ambient: 72, mode: "auto", action: "Auto" },
      isLoading: false,
      isError: false,
    });
  });

  it("calls setMode mutation when a chip is clicked", () => {
    renderTile();
    fireEvent.click(screen.getByTestId("chip-heat"));
    expect(mockSetModeMutate).toHaveBeenCalledWith("heat", expect.any(Object));
  });

  it("optimistically updates displayed setpoint when heat chip is clicked", () => {
    renderTile();
    fireEvent.click(screen.getByTestId("chip-heat"));
    // Heat chip preset is 76
    expect(screen.getByTestId("setpoint")).toHaveTextContent("76");
  });

  it("marks clicked chip as active immediately", () => {
    renderTile();
    fireEvent.click(screen.getByTestId("chip-heat"));
    expect(screen.getByTestId("chip-heat")).toHaveClass("on");
  });
});

describe("ClimateTile — slider interaction", () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue({
      data: { target: 70, ambient: 72, mode: "auto", action: "Idle" },
      isLoading: false,
      isError: false,
    });
  });

  it("updates the displayed setpoint when slider changes", () => {
    renderTile();
    const slider = screen.getByTestId("slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "75" } });
    expect(screen.getByTestId("setpoint")).toHaveTextContent("75");
  });

  it("updates mode pill to Heating when slider is moved above 74", () => {
    renderTile();
    const slider = screen.getByTestId("slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "76" } });
    expect(screen.getByText("Heating")).toBeInTheDocument();
  });

  it("updates mode pill to Cooling when slider is moved to 68", () => {
    renderTile();
    const slider = screen.getByTestId("slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "68" } });
    expect(screen.getByText("Cooling")).toBeInTheDocument();
  });
});
