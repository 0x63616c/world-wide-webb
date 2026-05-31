/**
 * ClimateTileView — pure presentational component tests.
 * No trpc mocking needed: all inputs are props.
 */

import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClimateTileViewProps } from "../ClimateTileView";
import { ClimateTileView, clampHigh, clampLow } from "../ClimateTileView";

afterEach(cleanup);

const cbs = { onSetTarget: vi.fn(), onSetMode: vi.fn(), onSetRange: vi.fn() };

// ─── pure clamp helpers — overlap / gap / bounds ──────────────────────────────

describe("clampLow / clampHigh", () => {
  it("keeps low at most GAP below high", () => {
    expect(clampLow(75, 76)).toBe(74); // can't reach high
    expect(clampLow(74, 76)).toBe(74); // exactly GAP below is allowed
  });

  it("keeps high at least GAP above low", () => {
    expect(clampHigh(69, 70)).toBe(72); // can't reach low
    expect(clampHigh(72, 70)).toBe(72); // exactly GAP above is allowed
  });

  it("never lets low cross or equal high", () => {
    expect(clampLow(99, 70)).toBe(68); // clamped to high-GAP
    expect(clampLow(70, 70)).toBe(68);
  });

  it("never lets high cross or equal low", () => {
    expect(clampHigh(60, 72)).toBe(74); // clamped to low+GAP
    expect(clampHigh(72, 72)).toBe(74);
  });

  it("respects the band edges", () => {
    expect(clampLow(50, 80)).toBe(65); // floor at MIN
    expect(clampHigh(99, 65)).toBe(80); // ceil at MAX
  });

  it("low and high stay >= GAP apart at the extremes", () => {
    // high pinned at the bottom: low must sit 2 below -> floors at MIN
    expect(clampLow(80, 67)).toBe(65);
    // low pinned at the top: high must sit 2 above -> ceils at MAX
    expect(clampHigh(65, 78)).toBe(80);
  });
});

// ─── loading state ────────────────────────────────────────────────────────────

describe("ClimateTileView — loading state", () => {
  it("renders without crashing", () => {
    const { container } = render(<ClimateTileView status="loading" />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it("does not render setpoint or sliders while loading", () => {
    render(<ClimateTileView status="loading" />);
    expect(screen.queryByTestId("setpoint")).not.toBeInTheDocument();
    expect(screen.queryByTestId("slider")).not.toBeInTheDocument();
    expect(screen.queryByTestId("slider-low")).not.toBeInTheDocument();
  });
});

// ─── single-setpoint modes (cool / heat) ──────────────────────────────────────

const coolProps: ClimateTileViewProps = {
  status: "populated",
  mode: "cool",
  target: 68,
  ambient: 72,
  action: "Cooling",
  ...cbs,
};

describe("ClimateTileView — cool/heat (single setpoint)", () => {
  it("shows the setpoint with °F", () => {
    render(<ClimateTileView {...coolProps} />);
    expect(screen.getByTestId("setpoint")).toHaveTextContent("68");
    expect(screen.getByTestId("setpoint")).toHaveTextContent("°F");
  });

  it("renders a single slider, no dual sliders", () => {
    render(<ClimateTileView {...coolProps} />);
    expect((screen.getByTestId("slider") as HTMLInputElement).value).toBe("68");
    expect(screen.queryByTestId("slider-low")).not.toBeInTheDocument();
    expect(screen.queryByTestId("slider-high")).not.toBeInTheDocument();
  });

  it("marks only the active mode button", () => {
    render(<ClimateTileView {...coolProps} />);
    expect(screen.getByTestId("chip-cool")).toHaveClass("on");
    expect(screen.getByTestId("chip-heat")).not.toHaveClass("on");
    expect(screen.getByTestId("chip-heat_cool")).not.toHaveClass("on");
    expect(screen.getByTestId("chip-off")).not.toHaveClass("on");
  });

  it("shows ambient marker and end labels", () => {
    render(<ClimateTileView {...coolProps} />);
    expect(screen.getByTestId("ambient-label")).toHaveTextContent("72°");
    expect(screen.getByText("65°")).toBeInTheDocument();
    expect(screen.getByText("80°")).toBeInTheDocument();
  });

  it("calls onSetTarget with the numeric slider value", () => {
    const onSetTarget = vi.fn();
    render(<ClimateTileView {...coolProps} onSetTarget={onSetTarget} />);
    fireEvent.change(screen.getByTestId("slider"), { target: { value: "75" } });
    expect(onSetTarget).toHaveBeenCalledWith(75);
  });
});

// ─── heat_cool (dual setpoint) ─────────────────────────────────────────────────

const heatCoolProps: ClimateTileViewProps = {
  status: "populated",
  mode: "heat_cool",
  targetLow: 68,
  targetHigh: 76,
  ambient: 72,
  action: "Idle",
  ...cbs,
};

describe("ClimateTileView — heat_cool (dual setpoint)", () => {
  it("renders two sliders and no single slider", () => {
    render(<ClimateTileView {...heatCoolProps} />);
    expect((screen.getByTestId("slider-low") as HTMLInputElement).value).toBe("68");
    expect((screen.getByTestId("slider-high") as HTMLInputElement).value).toBe("76");
    expect(screen.queryByTestId("slider")).not.toBeInTheDocument();
  });

  it("shows both setpoints in the readout", () => {
    render(<ClimateTileView {...heatCoolProps} />);
    expect(screen.getByTestId("setpoint")).toHaveTextContent("68");
    expect(screen.getByTestId("setpoint")).toHaveTextContent("76");
  });

  it("marks heat_cool active", () => {
    render(<ClimateTileView {...heatCoolProps} />);
    expect(screen.getByTestId("chip-heat_cool")).toHaveClass("on");
  });

  it("clamps low so it cannot reach high when dragged up", () => {
    const onSetRange = vi.fn();
    render(<ClimateTileView {...heatCoolProps} onSetRange={onSetRange} />);
    fireEvent.change(screen.getByTestId("slider-low"), { target: { value: "79" } });
    // high is 76, GAP 2 -> low clamped to 74
    expect(onSetRange).toHaveBeenCalledWith(74, 76);
  });

  it("clamps high so it cannot reach low when dragged down", () => {
    const onSetRange = vi.fn();
    render(<ClimateTileView {...heatCoolProps} onSetRange={onSetRange} />);
    fireEvent.change(screen.getByTestId("slider-high"), { target: { value: "66" } });
    // low is 68, GAP 2 -> high clamped to 70
    expect(onSetRange).toHaveBeenCalledWith(68, 70);
  });

  it("never emits an overlapping range across repeated cross attempts", () => {
    const onSetRange = vi.fn();
    render(<ClimateTileView {...heatCoolProps} onSetRange={onSetRange} />);
    fireEvent.change(screen.getByTestId("slider-low"), { target: { value: "80" } });
    fireEvent.change(screen.getByTestId("slider-high"), { target: { value: "65" } });
    for (const call of onSetRange.mock.calls) {
      const [low, high] = call as [number, number];
      expect(high - low).toBeGreaterThanOrEqual(2);
    }
  });
});

// ─── off ──────────────────────────────────────────────────────────────────────

describe("ClimateTileView — off", () => {
  const offProps: ClimateTileViewProps = {
    status: "populated",
    mode: "off",
    ambient: 71,
    action: "Off",
    ...cbs,
  };

  it("shows Off and no sliders", () => {
    render(<ClimateTileView {...offProps} />);
    expect(screen.getByTestId("setpoint")).toHaveTextContent("Off");
    expect(screen.queryByTestId("slider")).not.toBeInTheDocument();
    expect(screen.queryByTestId("slider-low")).not.toBeInTheDocument();
  });

  it("marks the Off button active", () => {
    render(<ClimateTileView {...offProps} />);
    expect(screen.getByTestId("chip-off")).toHaveClass("on");
  });
});

// ─── mode buttons ───────────────────────────────────────────────────────────-

describe("ClimateTileView — mode buttons", () => {
  it("fires onSetMode with the real hvac mode (no preset target)", () => {
    const onSetMode = vi.fn();
    render(<ClimateTileView {...coolProps} onSetMode={onSetMode} />);
    fireEvent.click(screen.getByTestId("chip-heat"));
    expect(onSetMode).toHaveBeenCalledWith("heat");
    fireEvent.click(screen.getByTestId("chip-heat_cool"));
    expect(onSetMode).toHaveBeenCalledWith("heat_cool");
    fireEvent.click(screen.getByTestId("chip-off"));
    expect(onSetMode).toHaveBeenCalledWith("off");
  });
});
