import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { ClimateTile, rangeFromTarget, targetFromRange } from "../ClimateTile";

// ── Mock the tRPC hooks ──────────────────────────────────────────────────────

const mockSetTargetMutate = vi.fn();
const mockSetRangeMutate = vi.fn();
const mockSetModeMutate = vi.fn();

const mockUseQuery = vi.fn();
// invalidate returns a promise so the settle path can chain .then(clearLocal).
const mockInvalidateClimateGet = vi.fn().mockResolvedValue(undefined);

// Capture the onSettled opts passed to each useMutation so tests can drive settle.
type MutOpts = { onSettled?: () => void };
const capturedOpts: { target?: MutOpts; range?: MutOpts; mode?: MutOpts } = {};

vi.mock("../../../lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ climate: { get: { invalidate: mockInvalidateClimateGet } } }),
    climate: {
      get: { useQuery: (...args: unknown[]) => mockUseQuery(...args) },
      setTarget: {
        useMutation: (opts?: MutOpts) => {
          capturedOpts.target = opts;
          return { mutate: mockSetTargetMutate };
        },
      },
      setRange: {
        useMutation: (opts?: MutOpts) => {
          capturedOpts.range = opts;
          return { mutate: mockSetRangeMutate };
        },
      },
      setMode: {
        useMutation: (opts?: MutOpts) => {
          capturedOpts.mode = opts;
          return { mutate: mockSetModeMutate };
        },
      },
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
    expect(rangeFromTarget(67)).toEqual({ low: 67, high: 70 });
    expect(rangeFromTarget(77)).toEqual({ low: 74, high: 77 });
  });

  it("targetFromRange returns the rounded midpoint", () => {
    expect(targetFromRange(68, 76)).toBe(72);
    expect(targetFromRange(68, 75)).toBe(72); // 71.5 rounds to 72
  });
});

// ── cool (single) ──────────────────────────────────────────────────────────────

describe("ClimateTile , cool (single setpoint)", () => {
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

describe("ClimateTile , heat_cool (dual setpoint)", () => {
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

describe("ClimateTile , off", () => {
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

describe("ClimateTile , no data", () => {
  it("renders skeleton when loading", () => {
    mockUseQuery.mockReturnValue({ data: undefined });
    renderTile();
    expect(screen.queryByTestId("setpoint")).not.toBeInTheDocument();
    expect(screen.queryByTestId("slider")).not.toBeInTheDocument();
  });
});

// ── mode switching ──────────────────────────────────────────────────────────────

describe("ClimateTile , mode switching", () => {
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

// ── www-unxz: instant desired , mutate immediately, no debounce, no snap-back ────
//
// The backend is desired-authoritative: a mutation writes desired and the next
// read returns that same value. The tile mutates IMMEDIATELY (no 400ms debounce)
// and invalidates on settle to pull the authoritative desired. The optimistic
// overlay must not snap back to a previous value between settle and the refetch
// landing.

describe("ClimateTile , www-unxz instant desired", () => {
  // Fire the captured onSettled (simulating the instant mutation completing) and
  // flush the invalidate().then(clearLocal) microtask inside act().
  const settle = async (opts: MutOpts | undefined) => {
    await act(async () => {
      opts?.onSettled?.();
      await Promise.resolve();
    });
  };

  it("fires setTarget immediately (no debounce) on slider change", () => {
    mockUseQuery.mockReturnValue({
      data: { mode: "cool", target: 74, ambient: 72, action: "Cooling" },
    });
    renderTile();

    fireEvent.change(screen.getByTestId("slider"), { target: { value: "71" } });
    // No timers advanced , the mutation must already have fired.
    expect(mockSetTargetMutate).toHaveBeenCalledWith(71);
    expect(screen.getByTestId("setpoint")).toHaveTextContent("71");
  });

  it("fires setRange immediately (no debounce) on range drag", () => {
    mockUseQuery.mockReturnValue({
      data: { mode: "heat_cool", targetLow: 68, targetHigh: 76, ambient: 72, action: "Idle" },
    });
    renderTile();

    fireEvent.change(screen.getByTestId("slider-low"), { target: { value: "70" } });
    expect(mockSetRangeMutate).toHaveBeenCalled();
    expect(screen.getByTestId("setpoint")).toHaveTextContent("70");
  });

  it("invalidates the climate query on settle to pull authoritative desired", async () => {
    mockUseQuery.mockReturnValue({
      data: { mode: "cool", target: 74, ambient: 72, action: "Cooling" },
    });
    renderTile();

    fireEvent.change(screen.getByTestId("slider"), { target: { value: "71" } });
    await settle(capturedOpts.target);
    expect(mockInvalidateClimateGet).toHaveBeenCalled();
  });

  it("setpoint stays on the new value when the refetch returns the new desired", async () => {
    mockUseQuery.mockReturnValue({
      data: { mode: "cool", target: 74, ambient: 72, action: "Cooling" },
    });
    const { rerender } = renderTile();

    fireEvent.change(screen.getByTestId("slider"), { target: { value: "71" } });
    expect(screen.getByTestId("setpoint")).toHaveTextContent("71");

    // Settle clears the optimistic overlay; the authoritative desired (71) is now
    // what the query returns, so the view stays on 71 , no snap-back.
    mockUseQuery.mockReturnValue({
      data: { mode: "cool", target: 71, ambient: 72, action: "Cooling" },
    });
    await settle(capturedOpts.target);
    act(() => rerender(<ClimateTile />));
    expect(screen.getByTestId("setpoint")).toHaveTextContent("71");
  });

  it("mode stays on the new mode after setMode settles (no revert)", async () => {
    mockUseQuery.mockReturnValue({
      data: { mode: "cool", target: 70, ambient: 72, action: "Cooling" },
    });
    const { rerender } = renderTile();

    fireEvent.click(screen.getByTestId("chip-heat"));
    expect(screen.getByTestId("chip-heat")).toHaveClass("on");

    // Authoritative desired now reports heat; overlay clears on settle.
    mockUseQuery.mockReturnValue({
      data: { mode: "heat", target: 70, ambient: 72, action: "Heating" },
    });
    await settle(capturedOpts.mode);
    act(() => rerender(<ClimateTile />));

    expect(screen.getByTestId("chip-heat")).toHaveClass("on");
    expect(screen.getByTestId("chip-cool")).not.toHaveClass("on");
  });
});
