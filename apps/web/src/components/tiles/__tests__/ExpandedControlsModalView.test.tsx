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
  lamps: { on: true, sub: "On", pending: false, brightness: 72 },
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
    ...over,
  };
}

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

describe("ExpandedControlsModalView — scene buttons", () => {
  it("renders all four scene buttons with exact accessible names", () => {
    render(<ExpandedControlsModalView {...baseProps()} />);
    expect(screen.getByRole("button", { name: "White" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mood" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Red" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Blue" })).toBeInTheDocument();
  });

  it("each scene button calls onScene with its scene id", () => {
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

  it("each scene tile renders a color swatch indicator", () => {
    render(<ExpandedControlsModalView {...baseProps()} />);
    for (const name of ["White", "Mood", "Red", "Blue"]) {
      const tile = screen.getByRole("button", { name });
      const swatch = tile.querySelector("[data-scene-swatch]") as HTMLElement | null;
      expect(swatch).not.toBeNull();
      // Swatch carries a non-empty background previewing the scene's color.
      expect(swatch?.style.background).not.toBe("");
    }
  });

  it("renders scene tiles as a 2x2 grid (not a flex chip row)", () => {
    render(<ExpandedControlsModalView {...baseProps()} />);
    // The four scene tiles share a common grid parent with two columns.
    const grid = screen.getByRole("button", { name: "White" }).parentElement as HTMLElement;
    expect(grid.style.display).toBe("grid");
    expect(grid.style.gridTemplateColumns).toBe("1fr 1fr");
    // All four tiles live in that same grid.
    for (const name of ["White", "Mood", "Red", "Blue"]) {
      expect(screen.getByRole("button", { name }).parentElement).toBe(grid);
    }
  });

  it("scene tiles are large tap targets (88px tall)", () => {
    render(<ExpandedControlsModalView {...baseProps()} />);
    for (const name of ["White", "Mood", "Red", "Blue"]) {
      expect(screen.getByRole("button", { name }).style.height).toBe("88px");
    }
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

  it("calls onBrightness with the numeric pct on change and updates the readout", () => {
    const onBrightness = vi.fn();
    render(<ExpandedControlsModalView {...baseProps({ onBrightness })} />);
    fireEvent.change(screen.getByLabelText("Brightness"), { target: { value: "42" } });
    expect(onBrightness).toHaveBeenCalledWith(42);
    // Controlled slider: the live readout reflects the dragged value immediately.
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect((screen.getByLabelText("Brightness") as HTMLInputElement).value).toBe("42");
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
