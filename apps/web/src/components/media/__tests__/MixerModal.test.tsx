/**
 * Tests for MixerModal (www-51hf.19).
 *
 * A24: Full-height grouped faders, global-link header control, per-group lock,
 *      per-room mute, live join/leave (coordinator anchor not removable).
 * A17: uses shared ui primitives (Modal).
 * A32: co-located test + stories.
 */
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MixerState } from "../hooks/useMixer";
import type { MixerModalProps } from "../MixerModal";
import { MixerModal } from "../MixerModal";

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
    uuid: "uuid-lr",
    deviceIp: "192.168.0.1",
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
    uuid: "uuid-desk",
    deviceIp: "192.168.0.2",
    memberUuids: ["uuid-desk"],
    name: "Desk",
    isCoordinator: true,
    volume: 30,
    muted: true,
    transportState: "PAUSED_PLAYBACK",
    sourceLabel: null,
  },
];

const baseMixer: MixerState = {
  vols: { "uuid-lr": 40, "uuid-desk": 30 },
  mutes: { "uuid-lr": false, "uuid-desk": true },
  member: {},
  globalLock: false,
  groupLock: false,
  setRoomVolume: vi.fn(),
  join: vi.fn(),
  leave: vi.fn(),
  toggleGroupLock: vi.fn(),
  setGlobalLock: vi.fn(),
  toggleMute: vi.fn(),
};

const baseProps: MixerModalProps = {
  open: true,
  onClose: vi.fn(),
  rooms: baseRooms,
  mixer: baseMixer,
  onSetVolume: vi.fn(),
  onSetMute: vi.fn(),
  onGroupJoin: vi.fn(),
  onGroupLeave: vi.fn(),
};

describe("MixerModal — closed", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(<MixerModal {...baseProps} open={false} />);
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });
});

describe("MixerModal — open (A24)", () => {
  it("renders a dialog", () => {
    render(<MixerModal {...baseProps} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders room names", () => {
    render(<MixerModal {...baseProps} />);
    expect(screen.getByText("Living Room")).toBeInTheDocument();
    expect(screen.getByText("Desk")).toBeInTheDocument();
  });

  it("renders a global link toggle (A24)", () => {
    render(<MixerModal {...baseProps} />);
    expect(screen.getByLabelText(/link all|global link/i)).toBeInTheDocument();
  });

  it("calls mixer.setGlobalLock when global link clicked", () => {
    const setGlobalLock = vi.fn();
    const mixer = { ...baseMixer, setGlobalLock };
    render(<MixerModal {...baseProps} mixer={mixer} />);
    fireEvent.click(screen.getByLabelText(/link all|global link/i));
    expect(setGlobalLock).toHaveBeenCalled();
  });

  it("renders mute buttons for each room (A24)", () => {
    render(<MixerModal {...baseProps} />);
    const muteButtons = screen.getAllByLabelText(/mute/i);
    expect(muteButtons.length).toBeGreaterThanOrEqual(2);
  });

  it("calls onSetMute when mute button is clicked", () => {
    const onSetMute = vi.fn();
    render(<MixerModal {...baseProps} onSetMute={onSetMute} />);
    const muteButtons = screen.getAllByLabelText(/mute/i);
    fireEvent.click(muteButtons[0]);
    expect(onSetMute).toHaveBeenCalled();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(<MixerModal {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText(/close/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
