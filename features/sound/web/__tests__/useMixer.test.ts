/**
 * Tests for useMixer , local volume/mute state and the lock.
 *
 * Lock semantics follow the Hammerspoon Sonos panel: with a lock on, moving
 * one room moves every locked room to the SAME displayed percentage (not the
 * same delta), because each room reaches that percentage through its own
 * calibration baseline. Unlocked, a move is solo even for a grouped room.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMixer } from "../hooks/useMixer";

beforeEach(() => {
  const { result, unmount } = twoRoomSetup(50, 60);
  act(() => {
    result.current.setGlobalLock(false);
    if (result.current.groupLock) result.current.toggleGroupLock();
  });
  unmount();
});

function twoRoomSetup(volA: number, volB: number) {
  const rooms = [
    { coordinatorUuid: "uuid-A", name: "Room A", volume: volA, muted: false },
    { coordinatorUuid: "uuid-B", name: "Room B", volume: volB, muted: false },
  ];
  return renderHook(() => useMixer(rooms, 1));
}

function sameGroupSetup(volA: number, volB: number) {
  const rooms = [
    { uuid: "uuid-A", coordinatorUuid: "grp", name: "Room A", volume: volA, muted: false },
    { uuid: "uuid-B", coordinatorUuid: "grp", name: "Room B", volume: volB, muted: false },
  ];
  return renderHook(() => useMixer(rooms, 1));
}

describe("useMixer , initial state", () => {
  it("seeds vols and mutes from the rooms array, locks off", () => {
    const rooms = [
      { coordinatorUuid: "uuid-A", name: "Room A", volume: 50, muted: true },
      { coordinatorUuid: "uuid-B", name: "Room B", volume: 20, muted: false },
    ];
    const { result } = renderHook(() => useMixer(rooms, 1));
    expect(result.current.vols).toEqual({ "uuid-A": 50, "uuid-B": 20 });
    expect(result.current.mutes).toEqual({ "uuid-A": true, "uuid-B": false });
    expect(result.current.globalLock).toBe(false);
    expect(result.current.groupLock).toBe(false);
  });
});

describe("useMixer , solo moves", () => {
  it("moves a single room without affecting others and reports only it", () => {
    const { result } = twoRoomSetup(50, 60);
    let changed: ReturnType<typeof result.current.setRoomVolume> = [];
    act(() => {
      changed = result.current.setRoomVolume("uuid-A", 70);
    });
    expect(result.current.vols).toEqual({ "uuid-A": 70, "uuid-B": 60 });
    expect(changed).toEqual([{ uuid: "uuid-A", volume: 70 }]);
  });

  it("clamps to 0..100 and reports nothing for a no-op move", () => {
    const { result } = twoRoomSetup(50, 60);
    act(() => result.current.setRoomVolume("uuid-A", -10));
    expect(result.current.vols["uuid-A"]).toBe(0);
    act(() => result.current.setRoomVolume("uuid-A", 150));
    expect(result.current.vols["uuid-A"]).toBe(100);
    let changed: ReturnType<typeof result.current.setRoomVolume> = [];
    act(() => {
      changed = result.current.setRoomVolume("uuid-A", 100);
    });
    expect(changed).toEqual([]);
  });

  it("moves ONLY the dragged room when both locks are off, even when grouped", () => {
    const { result } = sameGroupSetup(50, 60);
    act(() => result.current.setRoomVolume("uuid-A", 55));
    expect(result.current.vols).toEqual({ "uuid-A": 55, "uuid-B": 60 });
  });
});

describe("useMixer , locks snap every locked room to the same percentage", () => {
  it("keeps both locks after unmounting and remounting", () => {
    const storage = new Map<string, string>();
    const originalStorage = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    try {
      const first = twoRoomSetup(50, 60);
      act(() => {
        first.result.current.setGlobalLock(true);
        first.result.current.toggleGroupLock();
      });
      first.unmount();

      const second = twoRoomSetup(50, 60);
      expect(second.result.current.globalLock).toBe(true);
      expect(second.result.current.groupLock).toBe(true);
      expect(JSON.parse(storage.get("cc-sound-locks-v1") ?? "null")).toEqual({
        globalLock: true,
        groupLock: true,
      });
      second.unmount();
    } finally {
      if (originalStorage) Object.defineProperty(window, "localStorage", originalStorage);
    }
  });

  it("updates another mounted mixer when either lock changes", () => {
    const tile = twoRoomSetup(50, 60);
    const page = twoRoomSetup(50, 60);
    act(() => {
      page.result.current.setGlobalLock(true);
      tile.result.current.toggleGroupLock();
    });
    expect(tile.result.current.globalLock).toBe(true);
    expect(page.result.current.groupLock).toBe(true);
    tile.unmount();
    page.unmount();
  });

  it("groupLock: group-mates land on the moved room's value, and all are reported", () => {
    const { result } = sameGroupSetup(24, 29);
    act(() => result.current.toggleGroupLock());
    let changed: ReturnType<typeof result.current.setRoomVolume> = [];
    act(() => {
      changed = result.current.setRoomVolume("uuid-B", 80);
    });
    expect(result.current.vols).toEqual({ "uuid-A": 80, "uuid-B": 80 });
    expect(changed).toEqual(
      expect.arrayContaining([
        { uuid: "uuid-A", volume: 80 },
        { uuid: "uuid-B", volume: 80 },
      ]),
    );
  });

  it("groupLock does NOT touch rooms in a different coordinator group", () => {
    const rooms = [
      { uuid: "lr", coordinatorUuid: "grp-1", name: "Living Room", volume: 50, muted: false },
      { uuid: "kit", coordinatorUuid: "grp-1", name: "Kitchen", volume: 60, muted: false },
      { uuid: "bed", coordinatorUuid: "grp-2", name: "Bedroom", volume: 10, muted: false },
    ];
    const { result } = renderHook(() => useMixer(rooms, 1));
    act(() => result.current.toggleGroupLock());
    act(() => result.current.setRoomVolume("lr", 40));
    expect(result.current.vols).toEqual({ lr: 40, kit: 40, bed: 10 });
  });

  it("globalLock: ALL rooms regardless of group land on the moved value", () => {
    const rooms = [
      { uuid: "lr", coordinatorUuid: "grp-1", name: "Living Room", volume: 50, muted: false },
      { uuid: "bed", coordinatorUuid: "grp-2", name: "Bedroom", volume: 10, muted: false },
    ];
    const { result } = renderHook(() => useMixer(rooms, 1));
    act(() => result.current.setGlobalLock(true));
    act(() => result.current.setRoomVolume("bed", 33));
    expect(result.current.vols).toEqual({ lr: 33, bed: 33 });
  });

  it("a room already at the target is left alone and not reported", () => {
    const { result } = twoRoomSetup(40, 40);
    act(() => result.current.setGlobalLock(true));
    let changed: ReturnType<typeof result.current.setRoomVolume> = [];
    act(() => {
      changed = result.current.setRoomVolume("uuid-A", 40);
    });
    expect(changed).toEqual([]);
  });

  it("setGlobalLock(false) goes back to solo moves", () => {
    const { result } = twoRoomSetup(50, 60);
    act(() => result.current.setGlobalLock(true));
    act(() => result.current.setGlobalLock(false));
    act(() => result.current.setRoomVolume("uuid-A", 55));
    expect(result.current.vols).toEqual({ "uuid-A": 55, "uuid-B": 60 });
  });
});

describe("useMixer , mute", () => {
  it("flips a room's mute state and returns the new value", () => {
    const { result } = twoRoomSetup(50, 60);
    let next = false;
    act(() => {
      next = result.current.toggleMute("uuid-A");
    });
    expect(next).toBe(true);
    expect(result.current.mutes["uuid-A"]).toBe(true);
    act(() => {
      next = result.current.toggleMute("uuid-A");
    });
    expect(next).toBe(false);
  });
});

describe("useMixer , rooms prop changes", () => {
  it("prunes removed rooms and seeds added ones", () => {
    const initial = [
      { coordinatorUuid: "uuid-A", name: "Room A", volume: 50, muted: false },
      { coordinatorUuid: "uuid-B", name: "Room B", volume: 60, muted: false },
    ];
    const { result, rerender } = renderHook(({ rooms }) => useMixer(rooms, 1), {
      initialProps: { rooms: initial },
    });
    rerender({
      rooms: [
        { coordinatorUuid: "uuid-A", name: "Room A", volume: 50, muted: false },
        { coordinatorUuid: "uuid-C", name: "Room C", volume: 5, muted: true },
      ],
    });
    expect(result.current.vols).toEqual({ "uuid-A": 50, "uuid-C": 5 });
    expect(result.current.mutes).toEqual({ "uuid-A": false, "uuid-C": true });
  });
});

describe("useMixer , stale-poll reconcile (www-tavs)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:10.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const initial = [{ coordinatorUuid: "uuid-A", name: "Room A", volume: 50, muted: false }];
    return renderHook(({ rooms, at }) => useMixer(rooms, at), {
      initialProps: { rooms: initial, at: Date.now() - 5_000 },
    });
  }

  it("a snapshot fetched BEFORE a local edit never overwrites it", () => {
    const { result, rerender } = setup();
    act(() => result.current.setRoomVolume("uuid-A", 80));
    rerender({
      rooms: [{ coordinatorUuid: "uuid-A", name: "Room A", volume: 50, muted: false }],
      at: Date.now() - 5_000,
    });
    expect(result.current.vols["uuid-A"]).toBe(80);
  });

  it("a snapshot fetched AFTER the edit does overwrite it", () => {
    const { result, rerender } = setup();
    act(() => result.current.setRoomVolume("uuid-A", 80));
    vi.setSystemTime(new Date("2026-01-01T00:00:20.000Z"));
    rerender({
      rooms: [{ coordinatorUuid: "uuid-A", name: "Room A", volume: 55, muted: false }],
      at: Date.now(),
    });
    expect(result.current.vols["uuid-A"]).toBe(55);
  });

  it("a stale snapshot does not overwrite a local mute toggle", () => {
    const { result, rerender } = setup();
    act(() => result.current.toggleMute("uuid-A"));
    rerender({
      rooms: [{ coordinatorUuid: "uuid-A", name: "Room A", volume: 50, muted: false }],
      at: Date.now() - 5_000,
    });
    expect(result.current.mutes["uuid-A"]).toBe(true);
  });

  it("keeps a stable state reference when a poll returns unchanged values", () => {
    const { result, rerender } = setup();
    const before = result.current.vols;
    vi.setSystemTime(new Date("2026-01-01T00:00:20.000Z"));
    rerender({
      rooms: [{ coordinatorUuid: "uuid-A", name: "Room A", volume: 50, muted: false }],
      at: Date.now(),
    });
    expect(result.current.vols).toBe(before);
  });
});
