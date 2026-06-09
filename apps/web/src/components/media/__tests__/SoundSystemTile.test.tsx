/**
 * Tests for SoundSystemTileView (www-51hf.18).
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
  onFaderChange: vi.fn(),
  onToggleGlobalLock: vi.fn(),
  onOpenMixer: vi.fn(),
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
        onFaderChange={vi.fn()}
        onToggleGlobalLock={vi.fn()}
        onOpenMixer={vi.fn()}
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

  it("calls onOpenMixer when tile is clicked", () => {
    const onOpenMixer = vi.fn();
    render(<SoundSystemTileView {...baseProps} onOpenMixer={onOpenMixer} />);
    // The tile has an expand/mixer button
    const btn = screen.getByLabelText(/mixer|expand|open/i);
    fireEvent.click(btn);
    expect(onOpenMixer).toHaveBeenCalledTimes(1);
  });

  it("shows muted indicator for muted rooms", () => {
    const { container } = render(<SoundSystemTileView {...baseProps} />);
    // Muted room should have a visual indicator
    const muteIndicators = container.querySelectorAll("[data-muted='true']");
    expect(muteIndicators.length).toBeGreaterThan(0);
  });
});
