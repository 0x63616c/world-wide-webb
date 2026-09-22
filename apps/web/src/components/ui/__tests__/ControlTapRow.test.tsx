/**
 * ControlTapRow , dumb presentational button unit tests.
 * No trpc, no hooks; all state driven by props.
 */

import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlTapRow } from "../ControlTapRow";

afterEach(cleanup);

// ─── on/off state ───────────────────────────────────────────────────────────

describe("ControlTapRow , on/off state", () => {
  it("renders the label", () => {
    render(<ControlTapRow icon="lamp" label="Lamps" on={true} onToggle={vi.fn()} />);
    expect(screen.getByText("Lamps")).toBeInTheDocument();
  });

  it("renders 'On' status text when on=true", () => {
    render(<ControlTapRow icon="lamp" label="Lamps" on={true} onToggle={vi.fn()} />);
    expect(screen.getByText("On")).toBeInTheDocument();
  });

  it("renders 'Off' status text when on=false", () => {
    render(<ControlTapRow icon="bulb" label="Lights" on={false} onToggle={vi.fn()} />);
    expect(screen.getByText("Off")).toBeInTheDocument();
  });

  it("has aria-pressed=true when on", () => {
    render(<ControlTapRow icon="bulb" label="Lights" on={true} onToggle={vi.fn()} />);
    expect(screen.getByLabelText("Lights")).toHaveAttribute("aria-pressed", "true");
  });

  it("has aria-pressed=false when off", () => {
    render(<ControlTapRow icon="bulb" label="Lights" on={false} onToggle={vi.fn()} />);
    expect(screen.getByLabelText("Lights")).toHaveAttribute("aria-pressed", "false");
  });
});

// ─── bulb on/off glyph swap (www-cojw, evee parity) ────────────────────────────

describe("ControlTapRow , bulb glyph swaps by on-state", () => {
  it("renders the lit bulb when on", () => {
    const { container } = render(
      <ControlTapRow icon="bulb" label="Lights" on={true} onToggle={vi.fn()} />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class") ?? "").toContain("lucide-lightbulb");
    expect(svg?.getAttribute("class") ?? "").not.toContain("lucide-lightbulb-off");
  });

  it("renders the off bulb when off", () => {
    const { container } = render(
      <ControlTapRow icon="bulb" label="Lights" on={false} onToggle={vi.fn()} />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class") ?? "").toContain("lucide-lightbulb-off");
  });
});

// ─── fan spin ─────────────────────────────────────────────────────────────────

describe("ControlTapRow , fan spin animation", () => {
  it("spin is running when fan is on", () => {
    render(<ControlTapRow icon="fan" label="Fan" on={true} onToggle={vi.fn()} />);
    const spinEl = screen.getByLabelText("Fan").querySelector("[data-fan-spin]");
    expect(spinEl).toHaveStyle({ animationPlayState: "running" });
  });

  it("spin is paused when fan is off", () => {
    render(<ControlTapRow icon="fan" label="Fan" on={false} onToggle={vi.fn()} />);
    const spinEl = screen.getByLabelText("Fan").querySelector("[data-fan-spin]");
    expect(spinEl).toHaveStyle({ animationPlayState: "paused" });
  });
});

// ─── bolt icon ──────────────────────────────────────────────────────────────

describe("ControlTapRow , bolt icon", () => {
  it("renders the bolt glyph", () => {
    const { container } = render(
      <ControlTapRow icon="bolt" label="All" on={false} onToggle={vi.fn()} />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class") ?? "").toContain("lucide-zap");
  });
});

// ─── disabled variant ─────────────────────────────────────────────────────────

describe("ControlTapRow , disabled variant", () => {
  it("sets the disabled attribute on the button", () => {
    render(<ControlTapRow icon="lamp" label="Lamps" on={false} disabled onToggle={vi.fn()} />);
    expect(screen.getByLabelText("Lamps")).toBeDisabled();
  });

  it("does not fire onToggle when clicked while disabled", () => {
    const onToggle = vi.fn();
    render(<ControlTapRow icon="lamp" label="Lamps" on={false} disabled onToggle={onToggle} />);
    fireEvent.click(screen.getByLabelText("Lamps"));
    expect(onToggle).not.toHaveBeenCalled();
  });
});

// ─── callbacks ────────────────────────────────────────────────────────────────

describe("ControlTapRow , onToggle callback", () => {
  it("fires onToggle when clicked", () => {
    const onToggle = vi.fn();
    render(<ControlTapRow icon="lamp" label="Lamps" on={true} onToggle={onToggle} />);
    fireEvent.click(screen.getByLabelText("Lamps"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
