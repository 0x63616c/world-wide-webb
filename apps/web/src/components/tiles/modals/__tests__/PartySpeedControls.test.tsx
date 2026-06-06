/**
 * Party-speed widgets — presentational unit tests. Props-only (value + onChange),
 * no trpc/hooks.
 */

import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PARTY_SPEEDS,
  PartySpeed,
  PartySpeedCycle,
  PartySpeedSegmented,
  PartySpeedSlider,
} from "../PartySpeedControls";

afterEach(cleanup);

// ─── shared contract ──────────────────────────────────────────────────────────

describe("PARTY_SPEEDS contract", () => {
  it("is ordered slow → medium → fast (the index is the slider/cycle position)", () => {
    expect(PARTY_SPEEDS.map((s) => s.speed)).toEqual([
      PartySpeed.Slow,
      PartySpeed.Medium,
      PartySpeed.Fast,
    ]);
  });

  it("uses the canonical display labels", () => {
    expect(PARTY_SPEEDS.map((s) => s.label)).toEqual(["Slow", "Med", "Fast"]);
  });
});

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

  it("marks exactly one tab selected at a time", () => {
    render(<PartySpeedSegmented value={PartySpeed.Fast} onChange={vi.fn()} />);
    const selected = screen
      .getAllByRole("tab")
      .filter((t) => t.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveAccessibleName("Fast");
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

  it("fills the meter up to and including the active speed (Med = 2 of 3)", () => {
    const { container } = render(<PartySpeedCycle value={PartySpeed.Medium} onChange={vi.fn()} />);
    // The meter is the aria-hidden wrapper; each child span is one segment.
    const meter = container.querySelector("[aria-hidden]") as HTMLElement;
    const segments = Array.from(meter.children) as HTMLElement[];
    expect(segments).toHaveLength(3);
    const filled = segments.filter((s) => s.style.background.includes("--acc"));
    // Med is index 1 → segments 0 and 1 filled.
    expect(filled).toHaveLength(2);
  });

  it("fills all three meter segments at the fastest speed", () => {
    const { container } = render(<PartySpeedCycle value={PartySpeed.Fast} onChange={vi.fn()} />);
    const meter = container.querySelector("[aria-hidden]") as HTMLElement;
    const filled = (Array.from(meter.children) as HTMLElement[]).filter((s) =>
      s.style.background.includes("--acc"),
    );
    expect(filled).toHaveLength(3);
  });
});
