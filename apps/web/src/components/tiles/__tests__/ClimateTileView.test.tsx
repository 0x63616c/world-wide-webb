/**
 * ClimateTileView — pure presentational component tests.
 * No trpc mocking needed: all inputs are props.
 */

import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClimateTileViewProps } from "../ClimateTileView";
import { ClimateTileView } from "../ClimateTileView";

afterEach(cleanup);

// ─── loading state ────────────────────────────────────────────────────────────

describe("ClimateTileView — loading state", () => {
  it("renders without crashing", () => {
    const { container } = render(<ClimateTileView status="loading" />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it("does not render setpoint while loading", () => {
    render(<ClimateTileView status="loading" />);
    expect(screen.queryByTestId("setpoint")).not.toBeInTheDocument();
  });

  it("does not render slider while loading", () => {
    render(<ClimateTileView status="loading" />);
    expect(screen.queryByTestId("slider")).not.toBeInTheDocument();
  });
});

// ─── populated state ──────────────────────────────────────────────────────────

const baseProps: ClimateTileViewProps = {
  status: "populated",
  target: 68,
  ambient: 72,
  mode: "cool",
  action: "Cooling",
  onSetTarget: vi.fn(),
  onSetMode: vi.fn(),
};

describe("ClimateTileView — populated state", () => {
  it("shows the setpoint temperature", () => {
    render(<ClimateTileView {...baseProps} />);
    expect(screen.getByTestId("setpoint")).toHaveTextContent("68");
  });

  it("displays the °F suffix", () => {
    render(<ClimateTileView {...baseProps} />);
    expect(screen.getByTestId("setpoint")).toHaveTextContent("°F");
  });

  it("shows the mode pill label from action prop", () => {
    render(<ClimateTileView {...baseProps} />);
    expect(screen.getByTestId("mode-pill")).toHaveTextContent("Cooling");
  });

  it("marks the Cool chip as active when mode is cool", () => {
    render(<ClimateTileView {...baseProps} />);
    expect(screen.getByTestId("chip-cool")).toHaveClass("on");
    expect(screen.getByTestId("chip-heat")).not.toHaveClass("on");
    expect(screen.getByTestId("chip-auto")).not.toHaveClass("on");
  });

  it("marks the Heat chip as active when mode is heat", () => {
    render(<ClimateTileView {...baseProps} mode="heat" action="Heating" />);
    expect(screen.getByTestId("chip-heat")).toHaveClass("on");
    expect(screen.getByTestId("chip-cool")).not.toHaveClass("on");
  });

  it("marks the Auto chip as active when mode is auto", () => {
    render(<ClimateTileView {...baseProps} mode="auto" action="Idle" />);
    expect(screen.getByTestId("chip-auto")).toHaveClass("on");
  });

  it("shows ambient temperature marker", () => {
    render(<ClimateTileView {...baseProps} />);
    expect(screen.getByTestId("ambient-label")).toHaveTextContent("72°");
  });

  it("renders 65° and 80° end labels", () => {
    render(<ClimateTileView {...baseProps} />);
    expect(screen.getByText("65°")).toBeInTheDocument();
    expect(screen.getByText("80°")).toBeInTheDocument();
  });

  it("sets slider value to target", () => {
    render(<ClimateTileView {...baseProps} />);
    const slider = screen.getByTestId("slider") as HTMLInputElement;
    expect(slider.value).toBe("68");
  });

  it("mode pill reflects Idle action", () => {
    render(<ClimateTileView {...baseProps} mode="auto" action="Idle" />);
    expect(screen.getByTestId("mode-pill")).toHaveTextContent("Idle");
  });

  it("mode pill reflects Heating action from server", () => {
    render(<ClimateTileView {...baseProps} target={72} mode="heat" action="Heating" />);
    expect(screen.getByTestId("mode-pill")).toHaveTextContent("Heating");
  });
});

// ─── chip callbacks ───────────────────────────────────────────────────────────

describe("ClimateTileView — chip callbacks", () => {
  it("calls onSetMode with heat and preset 76 when Heat chip is clicked", () => {
    const onSetMode = vi.fn();
    render(<ClimateTileView {...baseProps} onSetMode={onSetMode} />);
    fireEvent.click(screen.getByTestId("chip-heat"));
    expect(onSetMode).toHaveBeenCalledWith("heat", 76);
  });

  it("calls onSetMode with cool and preset 68 when Cool chip is clicked", () => {
    const onSetMode = vi.fn();
    render(<ClimateTileView {...baseProps} mode="heat" action="Heating" onSetMode={onSetMode} />);
    fireEvent.click(screen.getByTestId("chip-cool"));
    expect(onSetMode).toHaveBeenCalledWith("cool", 68);
  });

  it("calls onSetMode with auto and preset 72 when Auto chip is clicked", () => {
    const onSetMode = vi.fn();
    render(<ClimateTileView {...baseProps} onSetMode={onSetMode} />);
    fireEvent.click(screen.getByTestId("chip-auto"));
    expect(onSetMode).toHaveBeenCalledWith("auto", 72);
  });
});

// ─── slider callback ──────────────────────────────────────────────────────────

describe("ClimateTileView — slider callback", () => {
  it("calls onSetTarget with numeric value when slider changes", () => {
    const onSetTarget = vi.fn();
    render(<ClimateTileView {...baseProps} onSetTarget={onSetTarget} />);
    const slider = screen.getByTestId("slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "75" } });
    expect(onSetTarget).toHaveBeenCalledWith(75);
  });

  it("calls onSetTarget with 76 for a high-end drag", () => {
    const onSetTarget = vi.fn();
    render(<ClimateTileView {...baseProps} onSetTarget={onSetTarget} />);
    const slider = screen.getByTestId("slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "76" } });
    expect(onSetTarget).toHaveBeenCalledWith(76);
  });
});
