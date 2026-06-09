/**
 * Tests for SoundSystemTileView (CC-51hf.18).
 *
 * A22: 5 Sonos rooms as grouped vertical faders, global link button,
 *      COORD sub-label, ganged-knob accent ring.
 * A17: uses shared ui primitives.
 * A32: co-located test + stories.
 */
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SoundSystemTileViewProps } from "../SoundSystemTileView";
import { SoundSystemTileView } from "../SoundSystemTileView";

afterEach(cleanup);

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

const baseProps: SoundSystemTileViewProps = {
  status: "populated",
  rooms: baseRooms,
  vols: { "uuid-lr": 40, "uuid-desk": 30 },
  mutes: { "uuid-lr": false, "uuid-desk": true },
  globalLock: false,
  groupLock: false,
  onFaderChange: vi.fn(),
  onToggleGlobalLock: vi.fn(),
  onToggleGroupLock: vi.fn(),
  onOpenMixer: vi.fn(),
  onOpenSource: vi.fn(),
};

describe("SoundSystemTileView — loading/error", () => {
  it("renders Skeleton when status=loading", () => {
    const { container } = render(
      <SoundSystemTileView
        status="loading"
        rooms={[]}
        vols={{}}
        mutes={{}}
        globalLock={false}
        groupLock={false}
        onFaderChange={vi.fn()}
        onToggleGlobalLock={vi.fn()}
        onToggleGroupLock={vi.fn()}
        onOpenMixer={vi.fn()}
        onOpenSource={vi.fn()}
      />,
    );
    expect(
      container.querySelector("[data-skeleton]") ?? container.querySelector("[aria-busy]"),
    ).toBeInTheDocument();
  });
});

describe("SoundSystemTileView — populated (A22)", () => {
  it("renders a header with Sound System label", () => {
    render(<SoundSystemTileView {...baseProps} />);
    expect(screen.getByText(/sound system/i)).toBeInTheDocument();
  });

  it("renders a room fader for each room", () => {
    render(<SoundSystemTileView {...baseProps} />);
    expect(screen.getByText("Living Room")).toBeInTheDocument();
    expect(screen.getByText("Desk")).toBeInTheDocument();
  });

  it("renders a volume value for each room", () => {
    render(<SoundSystemTileView {...baseProps} />);
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("renders a global link button", () => {
    render(<SoundSystemTileView {...baseProps} />);
    expect(screen.getByLabelText(/link all|global link/i)).toBeInTheDocument();
  });

  it("calls onToggleGlobalLock when link button clicked", () => {
    const onToggleGlobalLock = vi.fn();
    render(<SoundSystemTileView {...baseProps} onToggleGlobalLock={onToggleGlobalLock} />);
    fireEvent.click(screen.getByLabelText(/link all|global link/i));
    expect(onToggleGlobalLock).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenMixer when the tile surface is tapped", () => {
    const onOpenMixer = vi.fn();
    const { container } = render(<SoundSystemTileView {...baseProps} onOpenMixer={onOpenMixer} />);
    // The tile owns its tap surface (ownsTap) — tapping it opens the Mixer.
    const tile = container.querySelector(".tile");
    expect(tile).not.toBeNull();
    fireEvent.click(tile as Element);
    expect(onOpenMixer).toHaveBeenCalledTimes(1);
  });

  it("does not open the mixer when a fader's source button is tapped", () => {
    const onOpenMixer = vi.fn();
    const onOpenSource = vi.fn();
    render(
      <SoundSystemTileView {...baseProps} onOpenMixer={onOpenMixer} onOpenSource={onOpenSource} />,
    );
    fireEvent.click(screen.getByLabelText(/living room source/i));
    expect(onOpenSource).toHaveBeenCalledWith("uuid-lr");
    expect(onOpenMixer).not.toHaveBeenCalled();
  });

  it("renders a per-room source trigger and calls onOpenSource with the room uuid", () => {
    const onOpenSource = vi.fn();
    render(<SoundSystemTileView {...baseProps} onOpenSource={onOpenSource} />);
    const trigger = screen.getByLabelText(/living room source/i);
    fireEvent.click(trigger);
    expect(onOpenSource).toHaveBeenCalledWith("uuid-lr");
  });

  it("shows muted indicator for muted rooms", () => {
    const { container } = render(<SoundSystemTileView {...baseProps} />);
    // Muted room should have a visual indicator
    const muteIndicators = container.querySelectorAll("[data-muted='true']");
    expect(muteIndicators.length).toBeGreaterThan(0);
  });
});

// A playing multi-room group (Desk coordinates Bedroom) + idle solo rooms.
const groupedRooms = [
  {
    coordinatorUuid: "uuid-desk",
    uuid: "uuid-desk",
    deviceIp: "192.168.0.2",
    memberUuids: ["uuid-desk", "uuid-bed"],
    name: "Desk",
    isCoordinator: true,
    volume: 66,
    muted: false,
    transportState: "PLAYING",
    sourceLabel: "Line-in",
  },
  {
    coordinatorUuid: "uuid-desk",
    uuid: "uuid-bed",
    deviceIp: "192.168.0.3",
    memberUuids: ["uuid-desk", "uuid-bed"],
    name: "Bedroom",
    isCoordinator: false,
    volume: 68,
    muted: false,
    transportState: "PLAYING",
    sourceLabel: "Line-in",
  },
  {
    coordinatorUuid: "uuid-kit",
    uuid: "uuid-kit",
    deviceIp: "192.168.0.4",
    memberUuids: ["uuid-kit"],
    name: "Kitchen",
    isCoordinator: true,
    volume: 53,
    muted: false,
    transportState: "STOPPED",
    sourceLabel: null,
  },
];

describe("SoundSystemTileView — group panels (CC-xlyf)", () => {
  const groupedProps: SoundSystemTileViewProps = { ...baseProps, rooms: groupedRooms };

  it("labels the active panel from the source and the idle panel as Idle", () => {
    render(<SoundSystemTileView {...groupedProps} />);
    expect(screen.getByText("Line-in")).toBeInTheDocument();
    expect(screen.getByText(/^idle$/i)).toBeInTheDocument();
  });

  it("shows COORD for the coordinator of a multi-room group", () => {
    render(<SoundSystemTileView {...groupedProps} />);
    expect(screen.getByText("COORD")).toBeInTheDocument();
  });

  it("calls onToggleGroupLock when the group lock is clicked", () => {
    const onToggleGroupLock = vi.fn();
    render(<SoundSystemTileView {...groupedProps} onToggleGroupLock={onToggleGroupLock} />);
    fireEvent.click(screen.getByLabelText(/lock group/i));
    expect(onToggleGroupLock).toHaveBeenCalledTimes(1);
  });

  it("does not toggle the group lock while global lock is engaged (dimmed)", () => {
    const onToggleGroupLock = vi.fn();
    render(
      <SoundSystemTileView {...groupedProps} globalLock onToggleGroupLock={onToggleGroupLock} />,
    );
    fireEvent.click(screen.getByLabelText(/lock group/i));
    expect(onToggleGroupLock).not.toHaveBeenCalled();
  });
});
