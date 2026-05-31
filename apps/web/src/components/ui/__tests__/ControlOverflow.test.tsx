/**
 * ControlOverflow — overlay panel tests.
 * Verifies Rename + Scene actions appear and callbacks fire correctly.
 */

import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlOverflow } from "../ControlOverflow";

afterEach(cleanup);

// ─── visibility ────────────────────────────────────────────────────────────────

describe("ControlOverflow — visibility", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(
      <ControlOverflow
        label="Lamps"
        open={false}
        onClose={vi.fn()}
        onRename={vi.fn()}
        onScene={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders when open=true", () => {
    render(
      <ControlOverflow
        label="Lamps"
        open={true}
        onClose={vi.fn()}
        onRename={vi.fn()}
        onScene={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows the control label as the overflow heading", () => {
    render(
      <ControlOverflow
        label="Lamps"
        open={true}
        onClose={vi.fn()}
        onRename={vi.fn()}
        onScene={vi.fn()}
      />,
    );
    expect(screen.getByText("Lamps")).toBeInTheDocument();
  });
});

// ─── actions ───────────────────────────────────────────────────────────────────

describe("ControlOverflow — actions", () => {
  it("shows a Rename button", () => {
    render(
      <ControlOverflow
        label="Lights"
        open={true}
        onClose={vi.fn()}
        onRename={vi.fn()}
        onScene={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /rename/i })).toBeInTheDocument();
  });

  it("shows a Scene button", () => {
    render(
      <ControlOverflow
        label="Lights"
        open={true}
        onClose={vi.fn()}
        onRename={vi.fn()}
        onScene={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /scene/i })).toBeInTheDocument();
  });

  it("calls onRename when Rename is clicked", () => {
    const onRename = vi.fn();
    render(
      <ControlOverflow
        label="Lights"
        open={true}
        onClose={vi.fn()}
        onRename={onRename}
        onScene={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("calls onScene when Scene is clicked", () => {
    const onScene = vi.fn();
    render(
      <ControlOverflow
        label="Lights"
        open={true}
        onClose={vi.fn()}
        onRename={vi.fn()}
        onScene={onScene}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /scene/i }));
    expect(onScene).toHaveBeenCalledTimes(1);
  });
});

// ─── close ─────────────────────────────────────────────────────────────────────

describe("ControlOverflow — close", () => {
  it("shows a Close/dismiss button", () => {
    render(
      <ControlOverflow
        label="Fan"
        open={true}
        onClose={vi.fn()}
        onRename={vi.fn()}
        onScene={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <ControlOverflow
        label="Fan"
        open={true}
        onClose={onClose}
        onRename={vi.fn()}
        onScene={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
