/**
 * ControlsTileView — pure presentational component tests.
 * No trpc mocking needed: all inputs are props.
 */

import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlsTileViewProps } from "../ControlsTileView";
import { ControlsTileView } from "../ControlsTileView";

afterEach(cleanup);

const populatedProps: ControlsTileViewProps = {
  status: "populated",
  data: {
    lamps: { on: true, sub: "On", pending: false },
    lights: { on: false, pending: false },
    fan: { on: true, sub: "Medium", pending: false },
  },
  onToggle: vi.fn(),
};

// ─── loading state ────────────────────────────────────────────────────────────

describe("ControlsTileView — loading state", () => {
  it("renders without crashing", () => {
    const { container } = render(<ControlsTileView status="loading" />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it("shows Controls header", () => {
    render(<ControlsTileView status="loading" />);
    expect(screen.getByText("Controls")).toBeInTheDocument();
  });

  it("does not render tap buttons while loading", () => {
    render(<ControlsTileView status="loading" />);
    expect(screen.queryByLabelText("Lamps")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Lights")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Fan")).not.toBeInTheDocument();
  });
});

// ─── populated state ──────────────────────────────────────────────────────────

describe("ControlsTileView — populated state", () => {
  it("renders all four grid cells", () => {
    render(<ControlsTileView {...populatedProps} />);
    expect(screen.getByLabelText("Lamps")).toBeInTheDocument();
    expect(screen.getByLabelText("Lights")).toBeInTheDocument();
    expect(screen.getByLabelText("Fan")).toBeInTheDocument();
    expect(screen.getByLabelText("Scene")).toBeInTheDocument();
  });

  it("4th cell shows Scene label text", () => {
    render(<ControlsTileView {...populatedProps} />);
    expect(screen.getByText("Scene")).toBeInTheDocument();
    expect(screen.queryByText("More")).not.toBeInTheDocument();
  });

  it("Lamps reflects on state via aria-pressed", () => {
    render(<ControlsTileView {...populatedProps} />);
    expect(screen.getByLabelText("Lamps")).toHaveAttribute("aria-pressed", "true");
  });

  it("Lights reflects off state via aria-pressed", () => {
    render(<ControlsTileView {...populatedProps} />);
    expect(screen.getByLabelText("Lights")).toHaveAttribute("aria-pressed", "false");
  });

  it("Fan reflects on state via aria-pressed", () => {
    render(<ControlsTileView {...populatedProps} />);
    expect(screen.getByLabelText("Fan")).toHaveAttribute("aria-pressed", "true");
  });

  it("fan icon spin is running when fan is on", () => {
    render(<ControlsTileView {...populatedProps} />);
    const fanBtn = screen.getByLabelText("Fan");
    const spinEl = fanBtn.querySelector("[data-fan-spin]");
    expect(spinEl).not.toBeNull();
    expect(spinEl).toHaveStyle({ animationPlayState: "running" });
  });

  it("fan icon spin is paused when fan is off", () => {
    const props: ControlsTileViewProps = {
      ...populatedProps,
      data: { ...populatedProps.data, fan: { on: false, sub: "", pending: false } },
    } as ControlsTileViewProps;
    render(<ControlsTileView {...props} />);
    const fanBtn = screen.getByLabelText("Fan");
    const spinEl = fanBtn.querySelector("[data-fan-spin]");
    expect(spinEl).not.toBeNull();
    expect(spinEl).toHaveStyle({ animationPlayState: "paused" });
  });

  it("shows fan sub-label when fan is on", () => {
    render(<ControlsTileView {...populatedProps} />);
    expect(screen.getByText("Medium")).toBeInTheDocument();
  });

  it("shows lamp sub-label as On when lamps are on", () => {
    render(<ControlsTileView {...populatedProps} />);
    const lampsBtn = screen.getByLabelText("Lamps");
    expect(lampsBtn).toHaveTextContent("On");
  });

  it("shows data-pending on a pending control", () => {
    const props: ControlsTileViewProps = {
      ...populatedProps,
      data: {
        ...populatedProps.data,
        lamps: { on: true, sub: "On", pending: true },
      },
    } as ControlsTileViewProps;
    render(<ControlsTileView {...props} />);
    expect(screen.getByLabelText("Lamps")).toHaveAttribute("data-pending", "true");
  });
});

// ─── callbacks ────────────────────────────────────────────────────────────────

describe("ControlsTileView — onToggle callbacks", () => {
  it("calls onToggle with lamps key and current on value when Lamps clicked", () => {
    const onToggle = vi.fn();
    render(<ControlsTileView {...populatedProps} onToggle={onToggle} />);
    fireEvent.click(screen.getByLabelText("Lamps"));
    expect(onToggle).toHaveBeenCalledWith("lamps", true);
  });

  it("calls onToggle with lights key when Lights clicked", () => {
    const onToggle = vi.fn();
    render(<ControlsTileView {...populatedProps} onToggle={onToggle} />);
    fireEvent.click(screen.getByLabelText("Lights"));
    expect(onToggle).toHaveBeenCalledWith("lights", false);
  });

  it("calls onToggle with fan key when Fan clicked", () => {
    const onToggle = vi.fn();
    render(<ControlsTileView {...populatedProps} onToggle={onToggle} />);
    fireEvent.click(screen.getByLabelText("Fan"));
    expect(onToggle).toHaveBeenCalledWith("fan", true);
  });
});
