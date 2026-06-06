/**
 * ExpandedControlsModalView — pure presentational component tests.
 * No trpc mocking needed: all inputs/callbacks are props.
 */

import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlsViewData } from "../ControlsTileView";
import type { ExpandedControlsModalViewProps } from "../ExpandedControlsModalView";
import { ExpandedControlsModalView } from "../ExpandedControlsModalView";

afterEach(cleanup);

const allOn: ControlsViewData = {
  lamps: { on: true, sub: "On", pending: false, brightness: 72, activeScene: null },
  lights: { on: true, pending: false },
  fan: { on: true, sub: "Medium", pending: false },
};

const lampsOff: ControlsViewData = {
  lamps: { on: false, pending: false },
  lights: { on: true, pending: false },
  fan: { on: false, pending: false },
};

function baseProps(
  over: Partial<ExpandedControlsModalViewProps> = {},
): ExpandedControlsModalViewProps {
  return {
    open: true,
    onClose: vi.fn(),
    data: allOn,
    onToggle: vi.fn(),
    onScene: vi.fn(),
    onBrightness: vi.fn(),
    onPartySelect: vi.fn(),
    ...over,
  };
}

const partyActive: ControlsViewData = {
  ...allOn,
  lamps: { ...allOn.lamps, activeScene: "party" },
};

// ─── open / closed ──────────────────────────────────────────────────────────

describe("ExpandedControlsModalView — visibility", () => {
  it("renders nothing when open is false", () => {
    const { container } = render(<ExpandedControlsModalView {...baseProps({ open: false })} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders modal content when open", () => {
    render(<ExpandedControlsModalView {...baseProps()} />);
    // Reuses the grid — Lamps/Lights/Fan toggles are present
    expect(screen.getByLabelText("Lamps")).toBeInTheDocument();
    expect(screen.getByLabelText("Lights")).toBeInTheDocument();
    expect(screen.getByLabelText("Fan")).toBeInTheDocument();
  });
});

// ─── grid reuse, no More button inside the modal ──────────────────────────────

describe("ExpandedControlsModalView — reuses ControlsGridView", () => {
  it("does NOT render a 'More' button inside the modal (hideMore)", () => {
    render(<ExpandedControlsModalView {...baseProps()} />);
    expect(screen.queryByLabelText("More")).not.toBeInTheDocument();
  });

  it("forwards toggle clicks via onToggle with key + current on value", () => {
    const onToggle = vi.fn();
    render(<ExpandedControlsModalView {...baseProps({ onToggle })} />);
    fireEvent.click(screen.getByLabelText("Lamps"));
    expect(onToggle).toHaveBeenCalledWith("lamps", true);
  });
});

// ─── scene buttons ────────────────────────────────────────────────────────────

describe("ExpandedControlsModalView — scene tiles (ControlTap)", () => {
  it("renders all four scene tiles with exact accessible names", () => {
    render(<ExpandedControlsModalView {...baseProps()} />);
    expect(screen.getByRole("button", { name: "White" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mood" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Red" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Blue" })).toBeInTheDocument();
  });

  it("each scene tile calls onScene with its scene id", () => {
    const onScene = vi.fn();
    render(<ExpandedControlsModalView {...baseProps({ onScene })} />);
    fireEvent.click(screen.getByRole("button", { name: "White" }));
    fireEvent.click(screen.getByRole("button", { name: "Mood" }));
    fireEvent.click(screen.getByRole("button", { name: "Red" }));
    fireEvent.click(screen.getByRole("button", { name: "Blue" }));
    expect(onScene).toHaveBeenNthCalledWith(1, "white");
    expect(onScene).toHaveBeenNthCalledWith(2, "mood");
    expect(onScene).toHaveBeenNthCalledWith(3, "red");
    expect(onScene).toHaveBeenNthCalledWith(4, "blue");
  });

  it("each scene tile renders a ControlTap color swatch (no Icon svg)", () => {
    render(<ExpandedControlsModalView {...baseProps()} />);
    for (const name of ["White", "Mood", "Red", "Blue"]) {
      const tile = screen.getByRole("button", { name });
      const swatch = tile.querySelector("[data-swatch]") as HTMLElement | null;
      expect(swatch).not.toBeNull();
      // Swatch carries a non-empty background previewing the scene's color.
      expect(swatch?.style.background).not.toBe("");
      // Swatch variant replaces the Icon, so no svg in the scene tile.
      expect(tile.querySelector("svg")).toBeNull();
    }
  });

  it("highlights only the active scene tile (on=activeScene===scene)", () => {
    const data: ControlsViewData = { ...allOn, lamps: { ...allOn.lamps, activeScene: "blue" } };
    render(<ExpandedControlsModalView {...baseProps({ data })} />);
    expect(screen.getByRole("button", { name: "Blue" })).toHaveClass("on");
    expect(screen.getByRole("button", { name: "Blue" })).toHaveAttribute("aria-pressed", "true");
    for (const name of ["White", "Mood", "Red"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("highlights no scene tile when activeScene is null", () => {
    render(<ExpandedControlsModalView {...baseProps()} />);
    for (const name of ["White", "Mood", "Red", "Blue"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("renders scene tiles in a 2-column grid", () => {
    render(<ExpandedControlsModalView {...baseProps()} />);
    // Each ControlTap button is a direct child of the scene grid.
    const grid = screen.getByRole("button", { name: "White" }).parentElement as HTMLElement;
    expect(grid.style.display).toBe("grid");
    expect(grid.style.gridTemplateColumns).toBe("1fr 1fr");
    for (const name of ["White", "Mood", "Red", "Blue"]) {
      expect(screen.getByRole("button", { name }).parentElement).toBe(grid);
    }
  });

  it("no longer renders Party as a scene tile (it moved to the full-width control)", () => {
    render(<ExpandedControlsModalView {...baseProps()} />);
    // Party is now a tab, not a scene ControlTap with a swatch.
    expect(screen.queryByRole("button", { name: "Party" })).not.toBeInTheDocument();
  });
});

// ─── full-width party control ────────────────────────────────────────────────────

describe("ExpandedControlsModalView — party control", () => {
  it("renders the four-option party control (Off / Slow / Med / Fast)", () => {
    render(<ExpandedControlsModalView {...baseProps()} />);
    expect(screen.getByRole("tablist", { name: "Party" })).toBeInTheDocument();
    for (const name of ["Off", "Slow", "Med", "Fast"]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
  });

  it("marks Off active when party is not running", () => {
    render(<ExpandedControlsModalView {...baseProps()} />);
    expect(screen.getByRole("tab", { name: "Off" })).toHaveAttribute("aria-selected", "true");
    for (const name of ["Slow", "Med", "Fast"]) {
      expect(screen.getByRole("tab", { name })).toHaveAttribute("aria-selected", "false");
    }
  });

  it("marks the active speed when party is running", () => {
    render(<ExpandedControlsModalView {...baseProps({ data: partyActive, speed: "fast" })} />);
    expect(screen.getByRole("tab", { name: "Fast" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Off" })).toHaveAttribute("aria-selected", "false");
  });

  it("defaults the active segment to Med when party is on but speed is unset", () => {
    render(<ExpandedControlsModalView {...baseProps({ data: partyActive })} />);
    expect(screen.getByRole("tab", { name: "Med" })).toHaveAttribute("aria-selected", "true");
  });

  it("fires onPartySelect with the tapped speed", () => {
    const onPartySelect = vi.fn();
    render(<ExpandedControlsModalView {...baseProps({ onPartySelect })} />);
    fireEvent.click(screen.getByRole("tab", { name: "Fast" }));
    expect(onPartySelect).toHaveBeenCalledWith("fast");
  });

  it("fires onPartySelect with 'off' when Off is tapped", () => {
    const onPartySelect = vi.fn();
    render(
      <ExpandedControlsModalView
        {...baseProps({ data: partyActive, speed: "fast", onPartySelect })}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Off" }));
    expect(onPartySelect).toHaveBeenCalledWith("off");
  });

  it("disables the party control when lamps are off", () => {
    const onPartySelect = vi.fn();
    render(<ExpandedControlsModalView {...baseProps({ data: lampsOff, onPartySelect })} />);
    expect(screen.getByRole("tablist", { name: "Party" })).toHaveStyle({ pointerEvents: "none" });
    expect(screen.getByRole("tab", { name: "Fast" })).toBeDisabled();
  });

  it("omits the party control when onPartySelect is not provided", () => {
    render(<ExpandedControlsModalView {...baseProps({ onPartySelect: undefined })} />);
    expect(screen.queryByRole("tablist", { name: "Party" })).not.toBeInTheDocument();
  });
});

// ─── brightness slider ────────────────────────────────────────────────────────

describe("ExpandedControlsModalView — brightness slider", () => {
  it("renders a 0..100 range slider labelled Brightness", () => {
    render(<ExpandedControlsModalView {...baseProps()} />);
    const slider = screen.getByLabelText("Brightness") as HTMLInputElement;
    expect(slider).toBeInTheDocument();
    expect(slider.type).toBe("range");
    expect(slider.min).toBe("0");
    expect(slider.max).toBe("100");
  });

  it("is enabled when lamps are on", () => {
    render(<ExpandedControlsModalView {...baseProps({ data: allOn })} />);
    expect(screen.getByLabelText("Brightness")).not.toBeDisabled();
  });

  it("is disabled when lamps are off", () => {
    render(<ExpandedControlsModalView {...baseProps({ data: lampsOff })} />);
    expect(screen.getByLabelText("Brightness")).toBeDisabled();
  });

  it("seeds the slider value from data.lamps.brightness", () => {
    render(<ExpandedControlsModalView {...baseProps()} />);
    expect((screen.getByLabelText("Brightness") as HTMLInputElement).value).toBe("72");
  });

  it("shows a live percentage readout matching the value", () => {
    render(<ExpandedControlsModalView {...baseProps()} />);
    expect(screen.getByText("72%")).toBeInTheDocument();
  });

  it("defaults to 0 when brightness is absent", () => {
    const data: ControlsViewData = { ...allOn, lamps: { on: true, sub: "On", pending: false } };
    render(<ExpandedControlsModalView {...baseProps({ data })} />);
    expect((screen.getByLabelText("Brightness") as HTMLInputElement).value).toBe("0");
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("updates the readout immediately but debounces onBrightness (400ms trailing)", () => {
    vi.useFakeTimers();
    try {
      const onBrightness = vi.fn();
      render(<ExpandedControlsModalView {...baseProps({ onBrightness })} />);
      const slider = screen.getByLabelText("Brightness");

      // Controlled slider: the live readout reflects the dragged value immediately.
      fireEvent.change(slider, { target: { value: "42" } });
      expect(screen.getByText("42%")).toBeInTheDocument();
      expect((slider as HTMLInputElement).value).toBe("42");
      // ...but the backend mutation has NOT fired yet.
      expect(onBrightness).not.toHaveBeenCalled();

      vi.advanceTimersByTime(400);
      expect(onBrightness).toHaveBeenCalledTimes(1);
      expect(onBrightness).toHaveBeenCalledWith(42);
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces a rapid drag into a single onBrightness call for the final value", () => {
    vi.useFakeTimers();
    try {
      const onBrightness = vi.fn();
      render(<ExpandedControlsModalView {...baseProps({ onBrightness })} />);
      const slider = screen.getByLabelText("Brightness");

      // Dragging 50→0 quickly: each tick resets the timer, so only the last wins.
      for (let v = 50; v >= 0; v--) {
        fireEvent.change(slider, { target: { value: String(v) } });
      }
      vi.advanceTimersByTime(400);

      expect(onBrightness).toHaveBeenCalledTimes(1);
      expect(onBrightness).toHaveBeenCalledWith(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resyncs the slider when data.lamps.brightness changes upstream", () => {
    const { rerender } = render(<ExpandedControlsModalView {...baseProps()} />);
    expect((screen.getByLabelText("Brightness") as HTMLInputElement).value).toBe("72");
    const next: ControlsViewData = { ...allOn, lamps: { ...allOn.lamps, brightness: 30 } };
    rerender(<ExpandedControlsModalView {...baseProps({ data: next })} />);
    expect((screen.getByLabelText("Brightness") as HTMLInputElement).value).toBe("30");
    expect(screen.getByText("30%")).toBeInTheDocument();
  });
});

// ─── close ─────────────────────────────────────────────────────────────────────

describe("ExpandedControlsModalView — dismissal", () => {
  it("fires onClose when the modal close button is clicked", () => {
    const onClose = vi.fn();
    render(<ExpandedControlsModalView {...baseProps({ onClose })} />);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});
