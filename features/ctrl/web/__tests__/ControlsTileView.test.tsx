/**
 * ControlsTileView , pure presentational component tests.
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
    bedroomLamps: { on: false, pending: false },
    otherLamps: { on: true, pending: false },
    ceiling: { on: false, pending: false },
    cabinet: { on: false, pending: false },
    allOff: { on: false, pending: false },
  },
  onToggle: vi.fn(),
};

// ─── loading state ────────────────────────────────────────────────────────────

describe("ControlsTileView , loading state", () => {
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

describe("ControlsTileView , populated state", () => {
  it("renders all nine grid cells", () => {
    render(<ControlsTileView {...populatedProps} />);
    expect(screen.getByLabelText("Lamps")).toBeInTheDocument();
    expect(screen.getByLabelText("Lights")).toBeInTheDocument();
    expect(screen.getByLabelText("Fan")).toBeInTheDocument();
    expect(screen.getByLabelText("Bedroom")).toBeInTheDocument();
    expect(screen.getByLabelText("Other Lamps")).toBeInTheDocument();
    expect(screen.getByLabelText("Ceiling")).toBeInTheDocument();
    expect(screen.getByLabelText("Cabinet")).toBeInTheDocument();
    expect(screen.getByLabelText("All Off")).toBeInTheDocument();
    expect(screen.getByLabelText("More")).toBeInTheDocument();
  });

  it("9th cell shows more label text", () => {
    render(<ControlsTileView {...populatedProps} />);
    expect(screen.getByText("more")).toBeInTheDocument();
    expect(screen.queryByText("Scene")).not.toBeInTheDocument();
  });

  it("Bedroom reflects off state via aria-pressed", () => {
    render(<ControlsTileView {...populatedProps} />);
    expect(screen.getByLabelText("Bedroom")).toHaveAttribute("aria-pressed", "false");
  });

  it("Other Lamps reflects on state via aria-pressed", () => {
    render(<ControlsTileView {...populatedProps} />);
    expect(screen.getByLabelText("Other Lamps")).toHaveAttribute("aria-pressed", "true");
  });

  it("Ceiling and Cabinet reflect off state via aria-pressed", () => {
    render(<ControlsTileView {...populatedProps} />);
    expect(screen.getByLabelText("Ceiling")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Cabinet")).toHaveAttribute("aria-pressed", "false");
  });

  it("All Off always renders off, never pressed", () => {
    const props: ControlsTileViewProps = {
      ...populatedProps,
      data: { ...populatedProps.data, allOff: { on: false, pending: false } },
    } as ControlsTileViewProps;
    render(<ControlsTileView {...props} />);
    expect(screen.getByLabelText("All Off")).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onToggle with allOff key when All Off is clicked", () => {
    const onToggle = vi.fn();
    render(<ControlsTileView {...populatedProps} onToggle={onToggle} />);
    fireEvent.click(screen.getByLabelText("All Off"));
    expect(onToggle).toHaveBeenCalledWith("allOff", false);
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

// ─── layout ───────────────────────────────────────────────────────────────────

describe("ControlsTileView , layout", () => {
  it("tile root has padding 20 so bottom spacing matches sides", () => {
    const { container } = render(<ControlsTileView {...populatedProps} />);
    const tile = container.querySelector(".tile") as HTMLElement;
    expect(tile).not.toBeNull();
    expect(tile.style.padding).toBe("20px");
  });

  it("grid container has minHeight 0 to prevent flex overflow past bottom padding", () => {
    const { container } = render(<ControlsTileView {...populatedProps} />);
    const tile = container.querySelector(".tile") as HTMLElement;
    // The grid is the second child of the tile (after TileHeader)
    const grid = tile?.children[1] as HTMLElement;
    expect(grid).not.toBeNull();
    expect(grid.style.minHeight).toBe("0px");
  });
});

// ─── callbacks ────────────────────────────────────────────────────────────────

describe("ControlsTileView , onToggle callbacks", () => {
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

  it("calls onToggle with bedroomLamps key when Bedroom clicked", () => {
    const onToggle = vi.fn();
    render(<ControlsTileView {...populatedProps} onToggle={onToggle} />);
    fireEvent.click(screen.getByLabelText("Bedroom"));
    expect(onToggle).toHaveBeenCalledWith("bedroomLamps", false);
  });

  it("calls onToggle with otherLamps key when Other Lamps clicked", () => {
    const onToggle = vi.fn();
    render(<ControlsTileView {...populatedProps} onToggle={onToggle} />);
    fireEvent.click(screen.getByLabelText("Other Lamps"));
    expect(onToggle).toHaveBeenCalledWith("otherLamps", true);
  });

  it("calls onToggle with ceiling key when Ceiling clicked", () => {
    const onToggle = vi.fn();
    render(<ControlsTileView {...populatedProps} onToggle={onToggle} />);
    fireEvent.click(screen.getByLabelText("Ceiling"));
    expect(onToggle).toHaveBeenCalledWith("ceiling", false);
  });

  it("calls onToggle with cabinet key when Cabinet clicked", () => {
    const onToggle = vi.fn();
    render(<ControlsTileView {...populatedProps} onToggle={onToggle} />);
    fireEvent.click(screen.getByLabelText("Cabinet"));
    expect(onToggle).toHaveBeenCalledWith("cabinet", false);
  });
});
