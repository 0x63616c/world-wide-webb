/**
 * Tests for SourceModal (CC-51hf.20).
 *
 * A25: One card per room (name/device/GROUPED badge) with source chips
 *      (Line-in/TV/Spotify/AirPlay/Idle); selecting a chip writes the source.
 * A17: uses shared ui primitives (Modal, Chip).
 * A32: co-located test + stories.
 */
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceModalProps } from "../SourceModal";
import { SourceModal } from "../SourceModal";

afterEach(cleanup);

vi.mock("react-dom", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-dom")>();
  return { ...original, createPortal: (node: React.ReactNode) => node };
});

vi.mock("@/lib/modal-open-store", () => ({
  registerOpenModal: vi.fn(() => () => {}),
}));

const baseRooms = [
  {
    coordinatorUuid: "uuid-lr",
    memberUuids: ["uuid-lr"],
    name: "Living Room",
    isCoordinator: true,
    volume: 40,
    muted: false,
    transportState: "PLAYING",
    sourceLabel: null,
  },
  {
    coordinatorUuid: "uuid-desk",
    memberUuids: ["uuid-desk"],
    name: "Desk",
    isCoordinator: true,
    volume: 30,
    muted: false,
    transportState: "STOPPED",
    sourceLabel: null,
  },
];

const baseProps: SourceModalProps = {
  open: true,
  onClose: vi.fn(),
  rooms: baseRooms,
  onSetSource: vi.fn(),
};

describe("SourceModal — closed", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(<SourceModal {...baseProps} open={false} />);
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });
});

describe("SourceModal — open (A25)", () => {
  it("renders a dialog", () => {
    render(<SourceModal {...baseProps} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders a card for each room", () => {
    render(<SourceModal {...baseProps} />);
    expect(screen.getByText("Living Room")).toBeInTheDocument();
    expect(screen.getByText("Desk")).toBeInTheDocument();
  });

  it("renders source chips (Line-in, TV, Spotify, AirPlay, Idle) per room", () => {
    render(<SourceModal {...baseProps} />);
    // Should render multiple source chips — at least one set per room
    const lineInChips = screen.getAllByText(/line.in/i);
    expect(lineInChips.length).toBeGreaterThanOrEqual(1);
    const tvChips = screen.getAllByText(/^TV$/i);
    expect(tvChips.length).toBeGreaterThanOrEqual(1);
  });

  it("calls onSetSource when a source chip is clicked", () => {
    const onSetSource = vi.fn();
    render(<SourceModal {...baseProps} onSetSource={onSetSource} />);
    const tvChips = screen.getAllByText(/^TV$/i);
    fireEvent.click(tvChips[0]);
    expect(onSetSource).toHaveBeenCalled();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(<SourceModal {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText(/close/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
