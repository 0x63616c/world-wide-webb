/**
 * Tests for FavoritesModal (CC-51hf.24).
 *
 * A29: Real favorites cover grid + target/zone chip row; playing item is badged;
 *      tapping plays to the chosen zone.
 * A17: uses shared ui primitives (Modal, Chip).
 * A32: co-located test + stories.
 */
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FavoritesModalProps } from "../FavoritesModal";
import { FavoritesModal } from "../FavoritesModal";

afterEach(cleanup);

vi.mock("react-dom", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-dom")>();
  return { ...original, createPortal: (node: React.ReactNode) => node };
});

vi.mock("@/lib/modal-open-store", () => ({
  registerOpenModal: vi.fn(() => () => {}),
}));

const baseFavorites = [
  { title: "Chill Mix", uri: "x-sonosapi:chill", albumArtUri: null },
  { title: "Morning Vibes", uri: "x-sonosapi:morning", albumArtUri: null },
];

const baseZones = ["Living Room", "Desk", "Bedroom"];

const baseProps: FavoritesModalProps = {
  open: true,
  onClose: vi.fn(),
  favorites: baseFavorites,
  zones: baseZones,
  onPlay: vi.fn(),
};

describe("FavoritesModal — closed", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(<FavoritesModal {...baseProps} open={false} />);
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });
});

describe("FavoritesModal — open (A29)", () => {
  it("renders a dialog", () => {
    render(<FavoritesModal {...baseProps} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders all favorites", () => {
    render(<FavoritesModal {...baseProps} />);
    expect(screen.getByText("Chill Mix")).toBeInTheDocument();
    expect(screen.getByText("Morning Vibes")).toBeInTheDocument();
  });

  it("renders zone picker chips", () => {
    render(<FavoritesModal {...baseProps} />);
    expect(screen.getByText("Living Room")).toBeInTheDocument();
    expect(screen.getByText("Desk")).toBeInTheDocument();
    expect(screen.getByText("Bedroom")).toBeInTheDocument();
  });

  it("calls onPlay with favorite and selected zone when a favorite is clicked", () => {
    const onPlay = vi.fn();
    render(<FavoritesModal {...baseProps} onPlay={onPlay} />);
    // Click on a favorite
    fireEvent.click(screen.getByText("Chill Mix"));
    expect(onPlay).toHaveBeenCalledWith(baseFavorites[0], expect.any(String));
  });

  it("changes the target zone when a zone chip is clicked", () => {
    const onPlay = vi.fn();
    render(<FavoritesModal {...baseProps} onPlay={onPlay} />);
    // Click Desk zone chip
    fireEvent.click(screen.getByText("Desk"));
    // Now click a favorite — should play to Desk
    fireEvent.click(screen.getByText("Chill Mix"));
    expect(onPlay).toHaveBeenCalledWith(baseFavorites[0], "Desk");
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(<FavoritesModal {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText(/close/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
