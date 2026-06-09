/**
 * Tests for AllAppsModal (CC-51hf.22).
 *
 * A27: Searchable full-color grid of real source_list apps;
 *      currently-open app is marked; tapping launches it.
 * A17: uses shared ui primitives (Modal).
 * A32: co-located test + stories.
 */
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AllAppsModalProps } from "../AllAppsModal";
import { AllAppsModal } from "../AllAppsModal";

afterEach(cleanup);

vi.mock("react-dom", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-dom")>();
  return { ...original, createPortal: (node: React.ReactNode) => node };
});

vi.mock("@/lib/modal-open-store", () => ({
  registerOpenModal: vi.fn(() => () => {}),
}));

const baseProps: AllAppsModalProps = {
  open: true,
  onClose: vi.fn(),
  apps: ["Netflix", "Disney+", "Hulu", "Apple TV+", "YouTube", "Spotify"],
  currentApp: "Netflix",
  onLaunchApp: vi.fn(),
};

describe("AllAppsModal — closed", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(<AllAppsModal {...baseProps} open={false} />);
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });
});

describe("AllAppsModal — open (A27)", () => {
  it("renders a dialog", () => {
    render(<AllAppsModal {...baseProps} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders all apps", () => {
    render(<AllAppsModal {...baseProps} />);
    for (const app of baseProps.apps) {
      expect(screen.getByText(app)).toBeInTheDocument();
    }
  });

  it("renders a search input", () => {
    render(<AllAppsModal {...baseProps} />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("filters apps when search text is entered", () => {
    render(<AllAppsModal {...baseProps} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "net" } });
    expect(screen.getByText("Netflix")).toBeInTheDocument();
    expect(screen.queryByText("Disney+")).not.toBeInTheDocument();
  });

  it("calls onLaunchApp when an app is clicked", () => {
    const onLaunchApp = vi.fn();
    render(<AllAppsModal {...baseProps} onLaunchApp={onLaunchApp} />);
    fireEvent.click(screen.getByText("Disney+"));
    expect(onLaunchApp).toHaveBeenCalledWith("Disney+");
  });

  it("marks the current app as active", () => {
    const { container } = render(<AllAppsModal {...baseProps} />);
    // Current app should have a visual active indicator
    expect(container.querySelector("[data-active-app]")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(<AllAppsModal {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText(/close/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
