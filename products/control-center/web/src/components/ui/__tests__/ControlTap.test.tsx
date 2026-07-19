/**
 * ControlTap , dumb presentational button unit tests.
 * No trpc, no hooks; all state driven by props.
 */

import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlTap } from "../ControlTap";

afterEach(cleanup);

// ─── on state ────────────────────────────────────────────────────────────────

describe("ControlTap , on state", () => {
  it("renders the label", () => {
    render(<ControlTap icon="lamp" label="Lamps" on={true} onToggle={vi.fn()} />);
    expect(screen.getByText("Lamps")).toBeInTheDocument();
  });

  it("renders 'On' status text when on=true and no sub", () => {
    render(<ControlTap icon="lamp" label="Lamps" on={true} onToggle={vi.fn()} />);
    expect(screen.getByText("On")).toBeInTheDocument();
  });

  it("renders sub text instead of 'On' when sub is provided and on=true", () => {
    render(<ControlTap icon="lamp" label="Lamps" on={true} sub="Dim" onToggle={vi.fn()} />);
    expect(screen.getByText("Dim")).toBeInTheDocument();
    expect(screen.queryByText("On")).not.toBeInTheDocument();
  });

  it("has aria-pressed=true when on", () => {
    render(<ControlTap icon="bulb" label="Lights" on={true} onToggle={vi.fn()} />);
    expect(screen.getByLabelText("Lights")).toHaveAttribute("aria-pressed", "true");
  });
});

// ─── off state ────────────────────────────────────────────────────────────────

describe("ControlTap , off state", () => {
  it("renders the label", () => {
    render(<ControlTap icon="bulb" label="Lights" on={false} onToggle={vi.fn()} />);
    expect(screen.getByText("Lights")).toBeInTheDocument();
  });

  it("renders 'Off' status text when on=false", () => {
    render(<ControlTap icon="bulb" label="Lights" on={false} onToggle={vi.fn()} />);
    expect(screen.getByText("Off")).toBeInTheDocument();
  });

  it("has aria-pressed=false when off", () => {
    render(<ControlTap icon="bulb" label="Lights" on={false} onToggle={vi.fn()} />);
    expect(screen.getByLabelText("Lights")).toHaveAttribute("aria-pressed", "false");
  });
});

// ─── never ellipsis ───────────────────────────────────────────────────────────

describe("ControlTap , no ellipsis pending text", () => {
  it("never renders '…' even when pending=true and on=true", () => {
    render(<ControlTap icon="lamp" label="Lamps" on={true} pending={true} onToggle={vi.fn()} />);
    expect(screen.queryByText("…")).not.toBeInTheDocument();
    // still shows On/Off, not ellipsis
    expect(screen.getByText("On")).toBeInTheDocument();
  });

  it("never renders '…' even when pending=true and on=false", () => {
    render(<ControlTap icon="bulb" label="Lights" on={false} pending={true} onToggle={vi.fn()} />);
    expect(screen.queryByText("…")).not.toBeInTheDocument();
    expect(screen.getByText("Off")).toBeInTheDocument();
  });

  it("sets data-pending attribute when pending=true", () => {
    render(<ControlTap icon="lamp" label="Lamps" on={true} pending={true} onToggle={vi.fn()} />);
    expect(screen.getByLabelText("Lamps")).toHaveAttribute("data-pending", "true");
  });
});

// ─── status override (multi-state controls, e.g. Lights mode cycle) ───────────

describe("ControlTap , explicit status override", () => {
  it("renders the status text instead of the on/off default when status is set", () => {
    render(<ControlTap icon="bulb" label="Lights" on={true} status="K ON" onToggle={vi.fn()} />);
    expect(screen.getByText("K ON")).toBeInTheDocument();
    // The default "On" text must not appear when status overrides it.
    expect(screen.queryByText("On")).not.toBeInTheDocument();
  });

  it("shows the status even when off (e.g. OFF label), overriding the default 'Off'", () => {
    render(<ControlTap icon="bulb" label="Lights" on={false} status="OFF" onToggle={vi.fn()} />);
    expect(screen.getByText("OFF")).toBeInTheDocument();
  });

  it("still drives icon state from `on` while status overrides the text (off → bulb-off)", () => {
    const { container } = render(
      <ControlTap icon="bulb" label="Lights" on={false} status="OFF" onToggle={vi.fn()} />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class") ?? "").toContain("lucide-lightbulb-off");
  });

  it("falls back to the on/off default when status is omitted (backward compatible)", () => {
    render(<ControlTap icon="bulb" label="Lights" on={true} onToggle={vi.fn()} />);
    expect(screen.getByText("On")).toBeInTheDocument();
  });
});

// ─── fan spin ─────────────────────────────────────────────────────────────────

describe("ControlTap , fan spin animation", () => {
  it("spin is running when fan is on", () => {
    render(<ControlTap icon="fan" label="Fan" on={true} onToggle={vi.fn()} />);
    const spinEl = screen.getByLabelText("Fan").querySelector("[data-fan-spin]");
    expect(spinEl).not.toBeNull();
    expect(spinEl).toHaveStyle({ animationPlayState: "running" });
  });

  it("spin is paused when fan is off", () => {
    render(<ControlTap icon="fan" label="Fan" on={false} onToggle={vi.fn()} />);
    const spinEl = screen.getByLabelText("Fan").querySelector("[data-fan-spin]");
    expect(spinEl).not.toBeNull();
    expect(spinEl).toHaveStyle({ animationPlayState: "paused" });
  });
});

// ─── bulb on/off glyph swap (www-cojw, evee parity) ────────────────────────────

describe("ControlTap , bulb glyph swaps by on-state", () => {
  it("renders the lit bulb (lucide-lightbulb) when lights are on", () => {
    const { container } = render(
      <ControlTap icon="bulb" label="Lights" on={true} onToggle={vi.fn()} />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class") ?? "").toContain("lucide-lightbulb");
    expect(svg?.getAttribute("class") ?? "").not.toContain("lucide-lightbulb-off");
  });

  it("renders the off bulb (lucide-lightbulb-off) when lights are off", () => {
    const { container } = render(
      <ControlTap icon="bulb" label="Lights" on={false} onToggle={vi.fn()} />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class") ?? "").toContain("lucide-lightbulb-off");
  });
});

// ─── swatch variant ───────────────────────────────────────────────────────────

describe("ControlTap , swatch variant", () => {
  it("renders a color circle with the given color in place of the icon", () => {
    render(
      <ControlTap icon="bulb" label="Blue" on={false} swatch="rgb(0, 0, 255)" onToggle={vi.fn()} />,
    );
    const swatch = screen.getByLabelText("Blue").querySelector("[data-swatch]");
    expect(swatch).not.toBeNull();
    expect(swatch).toHaveStyle({ background: "rgb(0, 0, 255)", borderRadius: "50%" });
  });

  it("does not render the Icon when swatch is set", () => {
    const { container } = render(
      <ControlTap icon="bulb" label="Blue" on={false} swatch="rgb(0, 0, 255)" onToggle={vi.fn()} />,
    );
    // Icon renders an <svg>; swatch variant must not.
    expect(container.querySelector("svg")).toBeNull();
  });

  it("still renders the Icon (no swatch) for normal icon usages", () => {
    const { container } = render(
      <ControlTap icon="lamp" label="Lamps" on={true} onToggle={vi.fn()} />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("[data-swatch]")).toBeNull();
  });
});

// ─── disabled variant ─────────────────────────────────────────────────────────

describe("ControlTap , disabled variant", () => {
  it("sets the disabled attribute on the button", () => {
    render(<ControlTap icon="lamp" label="Party" on={false} disabled onToggle={vi.fn()} />);
    expect(screen.getByLabelText("Party")).toBeDisabled();
  });

  it("does not fire onToggle when clicked while disabled", () => {
    const onToggle = vi.fn();
    render(<ControlTap icon="lamp" label="Party" on={false} disabled onToggle={onToggle} />);
    fireEvent.click(screen.getByLabelText("Party"));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("dims the button when disabled", () => {
    render(<ControlTap icon="lamp" label="Party" on={false} disabled onToggle={vi.fn()} />);
    expect(screen.getByLabelText("Party")).toHaveStyle({ opacity: "0.4" });
  });

  it("is interactive (fires onToggle) when not disabled", () => {
    const onToggle = vi.fn();
    render(<ControlTap icon="lamp" label="Party" on={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByLabelText("Party"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

// ─── callbacks ────────────────────────────────────────────────────────────────

describe("ControlTap , onToggle callback", () => {
  it("fires onToggle when clicked", () => {
    const onToggle = vi.fn();
    render(<ControlTap icon="lamp" label="Lamps" on={true} onToggle={onToggle} />);
    fireEvent.click(screen.getByLabelText("Lamps"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

// ─── layout , single bottom line ─────────────────────────────────────────────

describe("ControlTap , bottom line layout", () => {
  it("label and status text are siblings in the same flex row", () => {
    const { container } = render(
      <ControlTap icon="lamp" label="Lamps" on={true} onToggle={vi.fn()} />,
    );
    // The bottom row is the last child of the button
    const btn = container.querySelector("button") as HTMLElement;
    const bottomRow = btn.lastElementChild as HTMLElement;
    expect(bottomRow).toHaveStyle({ display: "flex" });
    // Both label and status are in that same row
    const labelEl = Array.from(bottomRow.children).find((c) => c.textContent === "Lamps");
    expect(labelEl).toBeTruthy();
  });
});
