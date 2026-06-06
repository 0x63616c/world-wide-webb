/**
 * Party-speed widgets — presentational unit tests. Props-only (value + onChange),
 * no trpc/hooks.
 */

import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PartySpeed,
  PartySpeedCycle,
  PartySpeedSegmented,
  PartySpeedSlider,
} from "../PartySpeedControls";

afterEach(cleanup);

// ─── (a) segmented ──────────────────────────────────────────────────────────

describe("PartySpeedSegmented", () => {
  it("marks the active speed with aria-selected", () => {
    render(<PartySpeedSegmented value={PartySpeed.Medium} onChange={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Med" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Slow" })).toHaveAttribute("aria-selected", "false");
  });

  it("fires onChange with the tapped speed", () => {
    const onChange = vi.fn();
    render(<PartySpeedSegmented value={PartySpeed.Slow} onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "Fast" }));
    expect(onChange).toHaveBeenCalledWith(PartySpeed.Fast);
  });

  it("dims + blocks pointer events when disabled", () => {
    render(<PartySpeedSegmented value={PartySpeed.Slow} onChange={vi.fn()} disabled />);
    expect(screen.getByRole("tablist")).toHaveStyle({ pointerEvents: "none", opacity: "0.4" });
  });
});

// ─── (b) slider ─────────────────────────────────────────────────────────────

describe("PartySpeedSlider", () => {
  it("positions the slider at the active speed index", () => {
    render(<PartySpeedSlider value={PartySpeed.Fast} onChange={vi.fn()} />);
    // Fast is index 2 of [slow, med, fast].
    expect(screen.getByRole("slider", { name: "Party speed" })).toHaveValue("2");
  });

  it("snaps to a discrete speed on change", () => {
    const onChange = vi.fn();
    render(<PartySpeedSlider value={PartySpeed.Slow} onChange={onChange} />);
    fireEvent.change(screen.getByRole("slider", { name: "Party speed" }), {
      target: { value: "1" },
    });
    expect(onChange).toHaveBeenCalledWith(PartySpeed.Medium);
  });

  it("exposes the active label via aria-valuetext", () => {
    render(<PartySpeedSlider value={PartySpeed.Medium} onChange={vi.fn()} />);
    expect(screen.getByRole("slider", { name: "Party speed" })).toHaveAttribute(
      "aria-valuetext",
      "Med",
    );
  });

  it("is disabled when disabled", () => {
    render(<PartySpeedSlider value={PartySpeed.Slow} onChange={vi.fn()} disabled />);
    expect(screen.getByRole("slider", { name: "Party speed" })).toBeDisabled();
  });
});

// ─── (c) tap-to-cycle ─────────────────────────────────────────────────────────

describe("PartySpeedCycle", () => {
  it("shows the current speed label", () => {
    render(<PartySpeedCycle value={PartySpeed.Medium} onChange={vi.fn()} />);
    expect(screen.getByText("Med")).toBeInTheDocument();
  });

  it("reflects the current speed in the accessible name", () => {
    render(<PartySpeedCycle value={PartySpeed.Fast} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Party speed: Fast" })).toBeInTheDocument();
  });

  it("cycles to the next speed on tap", () => {
    const onChange = vi.fn();
    render(<PartySpeedCycle value={PartySpeed.Slow} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Party speed: Slow" }));
    expect(onChange).toHaveBeenCalledWith(PartySpeed.Medium);
  });

  it("wraps from the last speed back to the first", () => {
    const onChange = vi.fn();
    render(<PartySpeedCycle value={PartySpeed.Fast} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Party speed: Fast" }));
    expect(onChange).toHaveBeenCalledWith(PartySpeed.Slow);
  });

  it("does not fire onChange when disabled", () => {
    const onChange = vi.fn();
    render(<PartySpeedCycle value={PartySpeed.Slow} onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole("button", { name: "Party speed: Slow" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
