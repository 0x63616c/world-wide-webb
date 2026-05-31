import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { ClimateTile, rangeFromTarget, targetFromRange } from "../ClimateTile";

// ── Mock the tRPC hooks ──────────────────────────────────────────────────────

const mockSetTargetMutate = vi.fn();
const mockSetRangeMutate = vi.fn();
const mockSetModeMutate = vi.fn();

const mockUseQuery = vi.fn();
// invalidate returns a promise so the cooldown-expiry path can chain .then(clearLocal).
const mockInvalidateClimateGet = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ climate: { get: { invalidate: mockInvalidateClimateGet } } }),
    climate: {
      get: { useQuery: (...args: unknown[]) => mockUseQuery(...args) },
      setTarget: { useMutation: () => ({ mutate: mockSetTargetMutate }) },
      setRange: { useMutation: () => ({ mutate: mockSetRangeMutate }) },
      setMode: { useMutation: () => ({ mutate: mockSetModeMutate }) },
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const renderTile = () => render(<ClimateTile />);

// ── Pure seed helpers ─────────────────────────────────────────────────────────

describe("seed helpers", () => {
  it("rangeFromTarget brackets the target and respects the gap", () => {
    expect(rangeFromTarget(72)).toEqual({ low: 69, high: 75 });
  });

  it("rangeFromTarget stays in band at the edges", () => {
    expect(rangeFromTarget(65)).toEqual({ low: 65, high: 68 });
    expect(rangeFromTarget(80)).toEqual({ low: 77, high: 80 });
  });

  it("targetFromRange returns the rounded midpoint", () => {
    expect(targetFromRange(68, 76)).toBe(72);
    expect(targetFromRange(68, 75)).toBe(72); // 71.5 rounds to 72
  });
});

// ── cool (single) ──────────────────────────────────────────────────────────────

describe("ClimateTile — cool (single setpoint)", () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue({
      data: { mode: "cool", target: 68, ambient: 72, action: "Cooling" },
    });
  });

  it("shows the setpoint and °F from server data", () => {
    renderTile();
    expect(screen.getByTestId("setpoint")).toHaveTextContent("68");
    expect(screen.getByTestId("setpoint")).toHaveTextContent("°F");
  });

  it("renders a single slider set to target", () => {
    renderTile();
    expect((screen.getByTestId("slider") as HTMLInputElement).value).toBe("68");
    expect(screen.queryByTestId("slider-low")).not.toBeInTheDocument();
  });

  it("marks the Cool button active and shows the live action", () => {
    renderTile();
    expect(screen.getByTestId("chip-cool")).toHaveClass("on");
    expect(screen.getByTestId("mode-pill")).toHaveTextContent("Cooling");
  });

  it("optimistically updates the setpoint on slider change", () => {
    renderTile();
    fireEvent.change(screen.getByTestId("slider"), { target: { value: "75" } });
    expect(screen.getByTestId("setpoint")).toHaveTextContent("75");
  });
});

// ── heat_cool (dual) ────────────────────────────────────────────────────────────

describe("ClimateTile — heat_cool (dual setpoint)", () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue({
      data: { mode: "heat_cool", targetLow: 68, targetHigh: 76, ambient: 72, action: "Idle" },
    });
  });

  it("renders both sliders from server low/high", () => {
    renderTile();
    expect((screen.getByTestId("slider-low") as HTMLInputElement).value).toBe("68");
    expect((screen.getByTestId("slider-high") as HTMLInputElement).value).toBe("76");
    expect(screen.queryByTestId("slider")).not.toBeInTheDocument();
  });

  it("commits a clamped range on low drag (never overlaps)", () => {
    renderTile();
    fireEvent.change(screen.getByTestId("slider-low"), { target: { value: "79" } });
    expect(screen.getByTestId("slider-low")).toHaveValue("74"); // high 76 - gap 2
  });
});

// ── off ─────────────────────────────────────────────────────────────────────────

describe("ClimateTile — off", () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue({ data: { mode: "off", ambient: 71, action: "Idle" } });
  });

  it("shows Off and no sliders", () => {
    renderTile();
    expect(screen.getByTestId("setpoint")).toHaveTextContent("Off");
    expect(screen.queryByTestId("slider")).not.toBeInTheDocument();
    expect(screen.getByTestId("chip-off")).toHaveClass("on");
  });
});

// ── loading / error ───────────────────────────────────────────────────────────

describe("ClimateTile — no data", () => {
  it("renders skeleton when loading", () => {
    mockUseQuery.mockReturnValue({ data: undefined });
    renderTile();
    expect(screen.queryByTestId("setpoint")).not.toBeInTheDocument();
    expect(screen.queryByTestId("slider")).not.toBeInTheDocument();
  });
});

// ── mode switching ──────────────────────────────────────────────────────────────

describe("ClimateTile — mode switching", () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue({
      data: { mode: "cool", target: 70, ambient: 72, action: "Cooling" },
    });
  });

  it("calls setMode with the real hvac mode", () => {
    renderTile();
    fireEvent.click(screen.getByTestId("chip-heat"));
    expect(mockSetModeMutate).toHaveBeenCalledWith("heat");
  });

  it("never emits the fake 'auto' mode", () => {
    renderTile();
    fireEvent.click(screen.getByTestId("chip-heat_cool"));
    fireEvent.click(screen.getByTestId("chip-off"));
    const sent = mockSetModeMutate.mock.calls.map((c) => c[0]);
    expect(sent).not.toContain("auto");
    expect(sent).toEqual(["heat_cool", "off"]);
  });

  it("switching to heat_cool seeds a dual track around the current target", () => {
    renderTile();
    fireEvent.click(screen.getByTestId("chip-heat_cool"));
    // target 70 -> seeded low/high 67/73
    expect((screen.getByTestId("slider-low") as HTMLInputElement).value).toBe("67");
    expect((screen.getByTestId("slider-high") as HTMLInputElement).value).toBe("73");
  });

  it("marks the clicked mode active immediately", () => {
    renderTile();
    fireEvent.click(screen.getByTestId("chip-heat_cool"));
    expect(screen.getByTestId("chip-heat_cool")).toHaveClass("on");
  });
});

// ── www-59u: no snap-back to stale server value before cooldown refetch ──────────
//
// The mutation settles (HA returns 200) within tens of ms, long before the 5 s
// cooldown that pauses the refetch expires. The optimistic overlay must NOT be
// cleared on mutation-settle, or the view falls back to the stale paused
// query.data and visibly snaps back to the old value for ~5 s.

describe("ClimateTile — www-59u optimistic value survives until cooldown refetch", () => {
  // Pull the onSettled option (if any) the container passed to a mutation, then
  // fire it inside act() to simulate HA's near-instant 200 response.
  const settle = (mock: ReturnType<typeof vi.fn>) => {
    const opts = mock.mock.calls[0]?.[1] as { onSettled?: () => void } | undefined;
    act(() => opts?.onSettled?.());
  };

  it("setpoint stays on the new value after the setTarget mutation settles (no snap-back)", () => {
    vi.useFakeTimers();
    mockUseQuery.mockReturnValue({
      data: { mode: "cool", target: 74, ambient: 72, action: "Cooling" },
    });
    renderTile();

    const slider = screen.getByTestId("slider");
    fireEvent.change(slider, { target: { value: "71" } });
    // Release the slider so the View's transient drag state clears — from here the
    // displayed value falls back to the container's optimistic value (the bug surface).
    fireEvent.mouseUp(slider);
    expect(screen.getByTestId("setpoint")).toHaveTextContent("71");

    // Past the 400 ms debounce so the mutation fires, but well before the 5 s cooldown.
    act(() => vi.advanceTimersByTime(450));
    expect(mockSetTargetMutate).toHaveBeenCalled();

    settle(mockSetTargetMutate);

    // Server data is still the stale 74 (refetch is paused during cooldown); the
    // optimistic 71 must remain visible rather than reverting.
    expect(screen.getByTestId("setpoint")).toHaveTextContent("71");
  });

  it("dual-thumb range stays on the new values after setRange settles", () => {
    vi.useFakeTimers();
    mockUseQuery.mockReturnValue({
      data: { mode: "heat_cool", targetLow: 68, targetHigh: 76, ambient: 72, action: "Idle" },
    });
    renderTile();

    const low = screen.getByTestId("slider-low");
    fireEvent.change(low, { target: { value: "70" } });
    fireEvent.mouseUp(low);
    expect(screen.getByTestId("setpoint")).toHaveTextContent("70");

    act(() => vi.advanceTimersByTime(450));
    expect(mockSetRangeMutate).toHaveBeenCalled();

    settle(mockSetRangeMutate);

    expect(screen.getByTestId("setpoint")).toHaveTextContent("70");
  });

  it("mode stays on the new mode after setMode settles (no revert)", () => {
    vi.useFakeTimers();
    mockUseQuery.mockReturnValue({
      data: { mode: "cool", target: 70, ambient: 72, action: "Cooling" },
    });
    renderTile();

    fireEvent.click(screen.getByTestId("chip-heat"));
    expect(screen.getByTestId("chip-heat")).toHaveClass("on");

    settle(mockSetModeMutate);

    expect(screen.getByTestId("chip-heat")).toHaveClass("on");
    expect(screen.getByTestId("chip-cool")).not.toHaveClass("on");
  });
});
