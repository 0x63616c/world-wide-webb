import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SoundControls, SoundRoom } from "../hooks/useSoundControls";
import { SoundSystemPage } from "../SoundSystemPage";

afterEach(cleanup);

function room(name: string, entityId: string, overrides: Partial<SoundRoom> = {}): SoundRoom {
  const coordinatorUuid = overrides.coordinatorUuid ?? entityId;
  return {
    name,
    uuid: entityId,
    deviceIp: entityId,
    coordinatorUuid,
    memberUuids: [coordinatorUuid],
    isCoordinator: coordinatorUuid === entityId,
    volume: 30,
    baseline: null,
    muted: false,
    transportState: "STOPPED",
    sourceLabel: null,
    sourceKind: "idle",
    trackTitle: null,
    trackArtist: null,
    albumArtUri: null,
    availability: "available",
    groupStatus: coordinatorUuid === entityId ? "Standalone" : "Following desk",
    ...overrides,
  };
}

const livingRoom = room("Living Room", "media_player.living_room", {
  sourceKind: "tv",
  sourceLabel: "TV",
});
const desk = room("Desk", "media_player.desk", { baseline: 60 });
const kitchen = room("Kitchen", "media_player.kitchen", { coordinatorUuid: "media_player.desk" });
const rooms = [livingRoom, desk, kitchen];

function controls(overrides: Partial<SoundControls> = {}): SoundControls {
  const base: SoundControls = {
    status: "populated",
    rooms,
    dataUpdatedAt: 1,
    queryError: null,
    vols: { "media_player.living_room": 30, "media_player.desk": 50, "media_player.kitchen": 30 },
    mutes: {},
    globalLock: false,
    groupLock: false,
    calibratedCount: 1,
    setVolume: vi.fn(),
    stepVolume: vi.fn(),
    toggleMute: vi.fn(),
    setGlobalLock: vi.fn(),
    toggleGroupLock: vi.fn(),
    calibrate: { run: vi.fn(), isPending: false },
    clearCalibration: { run: vi.fn(), isPending: false },
    joinAllToDesk: { room: desk, pending: [livingRoom], isPending: false, run: vi.fn() },
    joinAllToTv: { room: livingRoom, pending: [desk, kitchen], isPending: false, run: vi.fn() },
    join: vi.fn(),
    leave: vi.fn(),
    error: null,
    notice: null,
  };
  return { ...base, ...overrides };
}

const diagnostics = {
  queriedAt: "2026-08-30T16:00:00.000Z",
  message: "3 Sonos rooms reported by Home Assistant",
};

describe("SoundSystemPage", () => {
  it("offers both one-tap groupings and runs them", () => {
    const c = controls();
    render(<SoundSystemPage controls={c} diagnostics={diagnostics} />);
    fireEvent.click(screen.getByRole("button", { name: "Join all to Desk" }));
    fireEvent.click(screen.getByRole("button", { name: "Join all to TV" }));
    expect(c.joinAllToDesk.run).toHaveBeenCalledTimes(1);
    expect(c.joinAllToTv.run).toHaveBeenCalledTimes(1);
  });

  it("disables the Desk action when everything is already on Desk, and TV when no TV room", () => {
    const c = controls({
      joinAllToDesk: { room: desk, pending: [], isPending: false, run: vi.fn() },
      joinAllToTv: { room: undefined, pending: [], isPending: false, run: vi.fn() },
    });
    render(<SoundSystemPage controls={c} diagnostics={diagnostics} />);
    expect(screen.getByRole("button", { name: "All on Desk" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "TV unavailable" })).toBeDisabled();
  });

  it("exposes calibrate, clear calibration and the lock", () => {
    const c = controls();
    render(<SoundSystemPage controls={c} diagnostics={diagnostics} />);
    fireEvent.click(screen.getByRole("button", { name: "Calibrate" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear calibration" }));
    fireEvent.click(screen.getByRole("button", { name: "Lock all rooms" }));
    expect(c.calibrate.run).toHaveBeenCalledTimes(1);
    expect(c.clearCalibration.run).toHaveBeenCalledTimes(1);
    expect(c.setGlobalLock).toHaveBeenCalledWith(true);
    expect(
      screen.getByText("1 of 3 rooms calibrated · volumes are % of baseline"),
    ).toBeInTheDocument();
  });

  it("disables Clear calibration when nothing is calibrated", () => {
    render(
      <SoundSystemPage controls={controls({ calibratedCount: 0 })} diagnostics={diagnostics} />,
    );
    expect(screen.getByRole("button", { name: "Clear calibration" })).toBeDisabled();
    expect(screen.getByText("Not calibrated · showing raw volume")).toBeInTheDocument();
  });

  it("steps a room by one point from the +/- buttons and drags the slider", () => {
    const c = controls();
    render(<SoundSystemPage controls={c} diagnostics={diagnostics} />);
    fireEvent.click(screen.getByLabelText("Desk up"));
    fireEvent.click(screen.getByLabelText("Desk down"));
    expect(c.stepVolume).toHaveBeenNthCalledWith(1, "media_player.desk", 1);
    expect(c.stepVolume).toHaveBeenNthCalledWith(2, "media_player.desk", -1);
    fireEvent.change(screen.getByLabelText("Desk volume"), { target: { value: "72" } });
    expect(c.setVolume).toHaveBeenCalledWith("media_player.desk", 72);
  });

  it("shows a calibrated room as a percentage and an uncalibrated one raw", () => {
    render(<SoundSystemPage controls={controls()} diagnostics={diagnostics} />);
    expect(screen.getByTestId("vol-media_player.desk")).toHaveTextContent("50%");
    expect(screen.getByTestId("vol-media_player.kitchen")).toHaveTextContent("30");
    expect(screen.getByTestId("vol-media_player.kitchen")).not.toHaveTextContent("%");
  });

  it("mutes a room and offers group moves", () => {
    const c = controls();
    render(<SoundSystemPage controls={c} diagnostics={diagnostics} />);
    fireEvent.click(screen.getByRole("button", { name: "Mute Kitchen" }));
    expect(c.toggleMute).toHaveBeenCalledWith("media_player.kitchen");
    fireEvent.click(screen.getByRole("button", { name: "Make standalone" }));
    expect(c.leave).toHaveBeenCalledWith(kitchen);
    fireEvent.change(screen.getByLabelText("Group Living Room with"), {
      target: { value: "media_player.kitchen" },
    });
    const [joinLivingRoom] = screen.getAllByRole("button", { name: "Join" });
    if (!joinLivingRoom) throw new Error("no Join button");
    fireEvent.click(joinLivingRoom);
    expect(c.join).toHaveBeenCalledWith(livingRoom, "media_player.kitchen");
  });

  it("surfaces notices and failed commands", () => {
    render(
      <SoundSystemPage
        controls={controls({ notice: "Calibrated 3 rooms. Each now reads 50%.", error: "HA down" })}
        diagnostics={diagnostics}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Calibrated 3 rooms");
    expect(screen.getByText("HA down")).toBeInTheDocument();
  });
});
