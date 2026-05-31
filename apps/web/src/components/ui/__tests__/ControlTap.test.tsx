/**
 * ControlTap — dumb presentational button unit tests.
 * No trpc, no hooks; all state driven by props.
 */

import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlTap } from "../ControlTap";

afterEach(cleanup);

// ─── on state ────────────────────────────────────────────────────────────────

describe("ControlTap — on state", () => {
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

describe("ControlTap — off state", () => {
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

describe("ControlTap — no ellipsis pending text", () => {
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

// ─── fan spin ─────────────────────────────────────────────────────────────────

describe("ControlTap — fan spin animation", () => {
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

// ─── callbacks ────────────────────────────────────────────────────────────────

describe("ControlTap — onToggle callback", () => {
  it("fires onToggle when clicked", () => {
    const onToggle = vi.fn();
    render(<ControlTap icon="lamp" label="Lamps" on={true} onToggle={onToggle} />);
    fireEvent.click(screen.getByLabelText("Lamps"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

// ─── layout — single bottom line ─────────────────────────────────────────────

describe("ControlTap — bottom line layout", () => {
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

// ─── onMore affordance ────────────────────────────────────────────────────────

describe("ControlTap — onMore affordance", () => {
  it("does not render a more button when onMore is not provided", () => {
    render(<ControlTap icon="lamp" label="Lamps" on={true} onToggle={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /more/i })).not.toBeInTheDocument();
  });

  it("renders a '> more' affordance button when onMore is provided", () => {
    render(<ControlTap icon="lamp" label="Lamps" on={true} onToggle={vi.fn()} onMore={vi.fn()} />);
    expect(screen.getByRole("button", { name: /more/i })).toBeInTheDocument();
  });

  it("calls onMore when the more button is clicked", () => {
    const onMore = vi.fn();
    render(<ControlTap icon="lamp" label="Lamps" on={true} onToggle={vi.fn()} onMore={onMore} />);
    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    expect(onMore).toHaveBeenCalledTimes(1);
  });

  it("clicking more does not also fire onToggle", () => {
    const onToggle = vi.fn();
    const onMore = vi.fn();
    render(<ControlTap icon="lamp" label="Lamps" on={true} onToggle={onToggle} onMore={onMore} />);
    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    expect(onToggle).not.toHaveBeenCalled();
  });
});
