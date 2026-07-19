/**
 * Modal , dumb presentational overlay + centered panel unit tests.
 * No trpc, no hooks; all state driven by props.
 */

import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal } from "../Modal";

afterEach(cleanup);

// ─── closed state ──────────────────────────────────────────────────────────

describe("Modal , closed", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(
      <Modal open={false} onClose={vi.fn()} title="Lamps">
        body
      </Modal>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

// ─── open state ────────────────────────────────────────────────────────────

describe("Modal , open", () => {
  it("renders a dialog with aria-modal when open=true", () => {
    render(
      <Modal open={true} onClose={vi.fn()} title="Lamps">
        body
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("renders the title", () => {
    render(
      <Modal open={true} onClose={vi.fn()} title="Lamps">
        body
      </Modal>,
    );
    expect(screen.getByText("Lamps")).toBeInTheDocument();
  });

  it("labels the dialog by its title", () => {
    render(
      <Modal open={true} onClose={vi.fn()} title="Lamps">
        body
      </Modal>,
    );
    expect(screen.getByRole("dialog", { name: "Lamps" })).toBeInTheDocument();
  });

  it("renders children inside the panel", () => {
    render(
      <Modal open={true} onClose={vi.fn()} title="Lamps">
        <span data-testid="child">scene grid</span>
      </Modal>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("renders a close button labeled 'Close'", () => {
    render(
      <Modal open={true} onClose={vi.fn()} title="Lamps">
        body
      </Modal>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("applies a minHeight floor to the panel when given", () => {
    render(
      <Modal open={true} onClose={vi.fn()} title="Lamps" minHeight={480}>
        body
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toHaveStyle({ minHeight: "480px" });
  });

  it("clamps minHeight to the panel's maxHeight so it never exceeds the board", () => {
    render(
      <Modal open={true} onClose={vi.fn()} title="Lamps" maxHeight={400} minHeight={800}>
        body
      </Modal>,
    );
    // minHeight (800) is clamped down to the clamped maxHeight (400).
    expect(screen.getByRole("dialog")).toHaveStyle({ minHeight: "400px" });
  });

  it("omits minHeight when not provided", () => {
    render(
      <Modal open={true} onClose={vi.fn()} title="Lamps">
        body
      </Modal>,
    );
    expect(screen.getByRole("dialog").style.minHeight).toBe("");
  });
});

// ─── dismissal ───────────────────────────────────────────────────────────────

describe("Modal , onClose", () => {
  it("fires onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose} title="Lamps">
        body
      </Modal>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fires onClose when the backdrop is clicked", () => {
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose} title="Lamps">
        body
      </Modal>,
    );
    fireEvent.click(screen.getByTestId("modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire onClose when clicking inside the panel", () => {
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose} title="Lamps">
        <span data-testid="child">scene grid</span>
      </Modal>,
    );
    fireEvent.click(screen.getByTestId("child"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("fires onClose on Escape keydown", () => {
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose} title="Lamps">
        body
      </Modal>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire onClose on other keydowns", () => {
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose} title="Lamps">
        body
      </Modal>,
    );
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does NOT listen for Escape when closed", () => {
    const onClose = vi.fn();
    render(
      <Modal open={false} onClose={onClose} title="Lamps">
        body
      </Modal>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
