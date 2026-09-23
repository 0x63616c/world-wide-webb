/**
 * ExpandedControlsView , pure presentational component tests.
 * No trpc mocking needed: all inputs/callbacks are props.
 */

import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlsViewData } from "../ControlsTileView";
import type { ExpandedControlsViewProps } from "../ExpandedControlsView";
import { ExpandedControlsView } from "../ExpandedControlsView";

afterEach(cleanup);

const allOn: ControlsViewData = {
  lamps: {
    on: true,
    sub: "On",
    pending: false,
    brightness: 72,
    activeScene: null,
  },
  lights: { on: true, pending: false },
  fan: { on: true, sub: "Medium", pending: false },
  bedroomLamps: { on: true, pending: false },
  otherLamps: { on: true, pending: false },
  ceiling: { on: true, pending: false },
  cabinet: { on: true, pending: false },
  all: { on: true, pending: false },
};

const lampsOff: ControlsViewData = {
  lamps: { on: false, pending: false },
  lights: { on: true, pending: false },
  fan: { on: false, pending: false },
  bedroomLamps: { on: false, pending: false },
  otherLamps: { on: false, pending: false },
  ceiling: { on: true, pending: false },
  cabinet: { on: false, pending: false },
  all: { on: false, pending: false },
};

function baseProps(over: Partial<ExpandedControlsViewProps> = {}): ExpandedControlsViewProps {
  return {
    data: allOn,
    onToggle: vi.fn(),
    onScene: vi.fn(),
    onBrightness: vi.fn(),
    onWhiteKelvin: vi.fn(),
    onColor: vi.fn(),
    onSaveColor: vi.fn(),
    onPartySelect: vi.fn(),
    ...over,
  };
}

const partyActive: ControlsViewData = {
  ...allOn,
  lamps: { ...allOn.lamps, activeScene: "party" },
};

// ─── content ────────────────────────────────────────────────────────────────

describe("ExpandedControlsView , content", () => {
  it("renders the toggle surface", () => {
    render(<ExpandedControlsView {...baseProps()} />);
    // Reuses ControlsGridView , all eight grouped toggles are present
    expect(screen.getByLabelText("Lamps")).toBeInTheDocument();
    expect(screen.getByLabelText("Lights")).toBeInTheDocument();
    expect(screen.getByLabelText("Fan")).toBeInTheDocument();
    expect(screen.getByLabelText("Bedroom")).toBeInTheDocument();
    expect(screen.getByLabelText("Living Room")).toBeInTheDocument();
    expect(screen.getByLabelText("Ceiling")).toBeInTheDocument();
    expect(screen.getByLabelText("Under Cabinet")).toBeInTheDocument();
    expect(screen.getByLabelText("All")).toBeInTheDocument();
  });
});

// ─── grid reuse, no More button inside the page ───────────────────────────────

describe("ExpandedControlsView , reuses ControlsGridView", () => {
  it("does NOT render a 'More' button inside the page (hideMore)", () => {
    render(<ExpandedControlsView {...baseProps()} />);
    expect(screen.queryByLabelText("More")).not.toBeInTheDocument();
  });

  it("forwards toggle clicks via onToggle with key + current on value", () => {
    const onToggle = vi.fn();
    render(<ExpandedControlsView {...baseProps({ onToggle })} />);
    fireEvent.click(screen.getByLabelText("Lamps"));
    expect(onToggle).toHaveBeenCalledWith("lamps", true);
  });
});

// ─── scene buttons ────────────────────────────────────────────────────────────

describe("ExpandedControlsView , scene tiles (ControlTap)", () => {
  it("renders the two non-custom scene tiles", () => {
    render(<ExpandedControlsView {...baseProps()} />);
    expect(screen.getByRole("button", { name: "White" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mood" })).toBeInTheDocument();
  });

  it("each scene tile calls onScene with its scene id", () => {
    const onScene = vi.fn();
    render(<ExpandedControlsView {...baseProps({ onScene })} />);
    fireEvent.click(screen.getByRole("button", { name: "White" }));
    fireEvent.click(screen.getByRole("button", { name: "Mood" }));
    expect(onScene).toHaveBeenNthCalledWith(1, "white");
    expect(onScene).toHaveBeenNthCalledWith(2, "mood");
  });

  it("each scene tile renders a ControlTap color swatch (no Icon svg)", () => {
    render(<ExpandedControlsView {...baseProps()} />);
    for (const name of ["White", "Mood"]) {
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
    const data: ControlsViewData = {
      ...allOn,
      lamps: { ...allOn.lamps, activeScene: "mood" },
    };
    render(<ExpandedControlsView {...baseProps({ data })} />);
    expect(screen.getByRole("button", { name: "Mood" })).toHaveClass("on");
    expect(screen.getByRole("button", { name: "Mood" })).toHaveAttribute("aria-pressed", "true");
    for (const name of ["White"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("highlights no scene tile when activeScene is null", () => {
    render(<ExpandedControlsView {...baseProps()} />);
    for (const name of ["White", "Mood"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("renders scene tiles in a 2-column grid", () => {
    render(<ExpandedControlsView {...baseProps()} />);
    // Each ControlTap button is a direct child of the scene grid.
    const grid = screen.getByRole("button", { name: "White" }).parentElement as HTMLElement;
    expect(grid.style.display).toBe("grid");
    expect(grid.style.gridTemplateColumns).toBe("1fr 1fr");
    for (const name of ["White", "Mood"]) {
      expect(screen.getByRole("button", { name }).parentElement).toBe(grid);
    }
  });

  it("no longer renders Party as a scene tile (it moved to the full-width control)", () => {
    render(<ExpandedControlsView {...baseProps()} />);
    // Party is now a tab, not a scene ControlTap with a swatch.
    expect(screen.queryByRole("button", { name: "Party" })).not.toBeInTheDocument();
  });
});

describe("ExpandedControlsView , saved colors", () => {
  it("applies a saved color from its large circle", () => {
    const onColor = vi.fn();
    render(<ExpandedControlsView {...baseProps({ onColor })} />);
    fireEvent.click(screen.getByRole("button", { name: "Use Custom 1" }));
    expect(onColor).toHaveBeenCalledWith("red");
  });

  it("opens a large picker and saves the edited color", () => {
    const onSaveColor = vi.fn();
    render(<ExpandedControlsView {...baseProps({ onSaveColor })} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Custom 2" }));
    expect(screen.getByRole("dialog", { name: "Edit Custom 2 color" })).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Hex color" });
    fireEvent.change(input, { target: { value: "#00ff00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & use" }));
    expect(onSaveColor).toHaveBeenCalledWith("blue", "#00ff00");
  });

  it("marks the swatch matching the lamp's active color as pressed, and no other", () => {
    const data: ControlsViewData = {
      ...allOn,
      lamps: { ...allOn.lamps, activeScene: "red" },
    };
    render(<ExpandedControlsView {...baseProps({ data })} />);
    expect(screen.getByRole("button", { name: "Use Custom 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const name of ["Use Custom 2", "Use Custom 3"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("marks no swatch as pressed when activeScene doesn't match a saved slot", () => {
    render(<ExpandedControlsView {...baseProps()} />);
    for (const name of ["Use Custom 1", "Use Custom 2", "Use Custom 3"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("suppresses the active-color indicator while editing colors", () => {
    const data: ControlsViewData = {
      ...allOn,
      lamps: { ...allOn.lamps, activeScene: "red" },
    };
    render(<ExpandedControlsView {...baseProps({ data })} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("button", { name: "Edit Custom 1" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

// ─── full-width party control ────────────────────────────────────────────────────

describe("ExpandedControlsView , party control", () => {
  it("renders the four-option party control (Off / Slow / Med / Fast)", () => {
    render(<ExpandedControlsView {...baseProps()} />);
    expect(screen.getByRole("tablist", { name: "Party" })).toBeInTheDocument();
    for (const name of ["Off", "Slow", "Med", "Fast"]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
  });

  it("marks Off active when party is not running", () => {
    render(<ExpandedControlsView {...baseProps()} />);
    expect(screen.getByRole("tab", { name: "Off" })).toHaveAttribute("aria-selected", "true");
    for (const name of ["Slow", "Med", "Fast"]) {
      expect(screen.getByRole("tab", { name })).toHaveAttribute("aria-selected", "false");
    }
  });

  it("marks the active speed when party is running", () => {
    render(<ExpandedControlsView {...baseProps({ data: partyActive, speed: "fast" })} />);
    expect(screen.getByRole("tab", { name: "Fast" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Off" })).toHaveAttribute("aria-selected", "false");
  });

  it("defaults the active segment to Med when party is on but speed is unset", () => {
    render(<ExpandedControlsView {...baseProps({ data: partyActive })} />);
    expect(screen.getByRole("tab", { name: "Med" })).toHaveAttribute("aria-selected", "true");
  });

  it("fires onPartySelect with the tapped speed", () => {
    const onPartySelect = vi.fn();
    render(<ExpandedControlsView {...baseProps({ onPartySelect })} />);
    fireEvent.click(screen.getByRole("tab", { name: "Fast" }));
    expect(onPartySelect).toHaveBeenCalledWith("fast");
  });

  it("fires onPartySelect with 'off' when Off is tapped", () => {
    const onPartySelect = vi.fn();
    render(
      <ExpandedControlsView {...baseProps({ data: partyActive, speed: "fast", onPartySelect })} />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Off" }));
    expect(onPartySelect).toHaveBeenCalledWith("off");
  });

  it("disables the party control when lamps are off", () => {
    const onPartySelect = vi.fn();
    render(<ExpandedControlsView {...baseProps({ data: lampsOff, onPartySelect })} />);
    expect(screen.getByRole("tablist", { name: "Party" })).toHaveStyle({
      pointerEvents: "none",
    });
    expect(screen.getByRole("tab", { name: "Fast" })).toBeDisabled();
  });

  it("omits the party control when onPartySelect is not provided", () => {
    render(<ExpandedControlsView {...baseProps({ onPartySelect: undefined })} />);
    expect(screen.queryByRole("tablist", { name: "Party" })).not.toBeInTheDocument();
  });
});

// ─── brightness slider ────────────────────────────────────────────────────────

describe("ExpandedControlsView , brightness slider", () => {
  it("renders a 0..100 range slider labeled Brightness", () => {
    render(<ExpandedControlsView {...baseProps()} />);
    const slider = screen.getByLabelText("Brightness") as HTMLInputElement;
    expect(slider).toBeInTheDocument();
    expect(slider.type).toBe("range");
    expect(slider.min).toBe("0");
    expect(slider.max).toBe("100");
  });

  it("is enabled when lamps are on", () => {
    render(<ExpandedControlsView {...baseProps({ data: allOn })} />);
    expect(screen.getByLabelText("Brightness")).not.toBeDisabled();
  });

  it("is disabled when lamps are off", () => {
    render(<ExpandedControlsView {...baseProps({ data: lampsOff })} />);
    expect(screen.getByLabelText("Brightness")).toBeDisabled();
  });

  it("seeds the slider value from data.lamps.brightness", () => {
    render(<ExpandedControlsView {...baseProps()} />);
    expect((screen.getByLabelText("Brightness") as HTMLInputElement).value).toBe("72");
  });

  it("shows a live percentage readout matching the value", () => {
    render(<ExpandedControlsView {...baseProps()} />);
    expect(screen.getByText("72%")).toBeInTheDocument();
  });

  it("defaults to 0 when brightness is absent", () => {
    const data: ControlsViewData = {
      ...allOn,
      lamps: { on: true, sub: "On", pending: false },
    };
    render(<ExpandedControlsView {...baseProps({ data })} />);
    expect((screen.getByLabelText("Brightness") as HTMLInputElement).value).toBe("0");
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("updates the readout immediately but debounces onBrightness (400ms trailing)", () => {
    vi.useFakeTimers();
    try {
      const onBrightness = vi.fn();
      render(<ExpandedControlsView {...baseProps({ onBrightness })} />);
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
      render(<ExpandedControlsView {...baseProps({ onBrightness })} />);
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
    const { rerender } = render(<ExpandedControlsView {...baseProps()} />);
    expect((screen.getByLabelText("Brightness") as HTMLInputElement).value).toBe("72");
    const next: ControlsViewData = {
      ...allOn,
      lamps: { ...allOn.lamps, brightness: 30 },
    };
    rerender(<ExpandedControlsView {...baseProps({ data: next })} />);
    expect((screen.getByLabelText("Brightness") as HTMLInputElement).value).toBe("30");
    expect(screen.getByText("30%")).toBeInTheDocument();
  });

  describe("white temperature", () => {
    it("renders the slider seeded from data.lamps.whiteKelvin with a kelvin readout", () => {
      render(
        <ExpandedControlsView
          {...baseProps({ data: { ...allOn, lamps: { ...allOn.lamps, whiteKelvin: 3100 } } })}
        />,
      );
      const slider = screen.getByRole("slider", { name: "White temperature" });
      expect(slider).toHaveValue("3100");
      expect(document.querySelector("[data-white-kelvin-readout]")?.textContent).toBe("3100K");
    });

    it("debounces the change into one onWhiteKelvin call with the settled value", () => {
      vi.useFakeTimers();
      try {
        const onWhiteKelvin = vi.fn();
        render(<ExpandedControlsView {...baseProps({ onWhiteKelvin })} />);
        const slider = screen.getByRole("slider", { name: "White temperature" });
        fireEvent.change(slider, { target: { value: "2500" } });
        fireEvent.change(slider, { target: { value: "4000" } });
        expect(onWhiteKelvin).not.toHaveBeenCalled();
        vi.advanceTimersByTime(400);
        expect(onWhiteKelvin).toHaveBeenCalledTimes(1);
        expect(onWhiteKelvin).toHaveBeenCalledWith(4000);
      } finally {
        vi.useRealTimers();
      }
    });

    it("hides the slider when no onWhiteKelvin handler is wired", () => {
      render(<ExpandedControlsView {...baseProps({ onWhiteKelvin: undefined })} />);
      expect(screen.queryByRole("slider", { name: "White temperature" })).toBeNull();
    });
  });
});
