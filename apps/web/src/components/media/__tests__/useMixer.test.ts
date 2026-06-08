/**
 * Tests for useMixer hook (www-51hf.14).
 *
 * Covers the gang-lock algorithm: same-delta moves, clamp-at-bounds, offset
 * preservation. The canonical handoff example: rooms at 24 & 29, dragging the
 * 29 fader up by +76 → would exceed 100; gang stops when any member hits 0/100,
 * so the delta is limited to +71 (29+71=100, 24+71=95).
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useMixer } from "../hooks/useMixer";

// Helper: initialise hook with a simple two-room locked gang.
function twoRoomSetup(volA: number, volB: number) {
  const rooms = [
    { coordinatorUuid: "uuid-A", name: "Room A", volume: volA, muted: false },
    { coordinatorUuid: "uuid-B", name: "Room B", volume: volB, muted: false },
  ];
  return renderHook(() => useMixer(rooms));
}

describe("useMixer — initial state", () => {
  it("exposes vols, member, globalLock, groupLock, mutes fields", () => {
    const rooms = [{ coordinatorUuid: "uuid-A", name: "Room A", volume: 50, muted: false }];
    const { result } = renderHook(() => useMixer(rooms));
    expect(result.current).toMatchObject({
      vols: expect.any(Object),
      member: expect.any(Object),
      globalLock: expect.any(Boolean),
      groupLock: expect.any(Boolean),
      mutes: expect.any(Object),
    });
    expect(typeof result.current.setRoomVolume).toBe("function");
    expect(typeof result.current.join).toBe("function");
    expect(typeof result.current.leave).toBe("function");
    expect(typeof result.current.toggleGroupLock).toBe("function");
    expect(typeof result.current.setGlobalLock).toBe("function");
    expect(typeof result.current.toggleMute).toBe("function");
  });

  it("seeds vols from the incoming rooms array", () => {
    const rooms = [
      { coordinatorUuid: "uuid-A", name: "Room A", volume: 42, muted: false },
      { coordinatorUuid: "uuid-B", name: "Room B", volume: 77, muted: false },
    ];
    const { result } = renderHook(() => useMixer(rooms));
    expect(result.current.vols["uuid-A"]).toBe(42);
    expect(result.current.vols["uuid-B"]).toBe(77);
  });

  it("seeds mutes from the incoming rooms array", () => {
    const rooms = [
      { coordinatorUuid: "uuid-A", name: "Room A", volume: 50, muted: true },
      { coordinatorUuid: "uuid-B", name: "Room B", volume: 50, muted: false },
    ];
    const { result } = renderHook(() => useMixer(rooms));
    expect(result.current.mutes["uuid-A"]).toBe(true);
    expect(result.current.mutes["uuid-B"]).toBe(false);
  });

  it("starts with groupLock off and globalLock off", () => {
    const { result } = renderHook(() =>
      useMixer([{ coordinatorUuid: "uuid-A", name: "Room A", volume: 50, muted: false }]),
    );
    expect(result.current.groupLock).toBe(false);
    expect(result.current.globalLock).toBe(false);
  });
});

describe("useMixer — solo fader (no gang)", () => {
  it("moves a single room's fader without affecting others", () => {
    const { result } = twoRoomSetup(50, 70);
    act(() => result.current.setRoomVolume("uuid-A", 60));
    expect(result.current.vols["uuid-A"]).toBe(60);
    expect(result.current.vols["uuid-B"]).toBe(70);
  });

  it("clamps solo fader at 0 (lower bound)", () => {
    const { result } = twoRoomSetup(5, 70);
    act(() => result.current.setRoomVolume("uuid-A", -10));
    expect(result.current.vols["uuid-A"]).toBe(0);
  });

  it("clamps solo fader at 100 (upper bound)", () => {
    const { result } = twoRoomSetup(95, 70);
    act(() => result.current.setRoomVolume("uuid-A", 110));
    expect(result.current.vols["uuid-A"]).toBe(100);
  });
});

describe("useMixer — gang-lock algorithm (groupLock)", () => {
  it("moves all members by the same delta when groupLock is on", () => {
    const { result } = twoRoomSetup(50, 60);
    act(() => result.current.toggleGroupLock());
    // Drag uuid-A from 50 to 55 (+5 delta)
    act(() => result.current.setRoomVolume("uuid-A", 55));
    expect(result.current.vols["uuid-A"]).toBe(55);
    expect(result.current.vols["uuid-B"]).toBe(65);
  });

  it("offset preservation: canonical example 24 & 29, delta +76 → 95 & 100 (stops at ceiling)", () => {
    // Handoff example: dragging the 29 fader by +76 would put it at 105,
    // but it clamps to 100; 29 → 100 means actual delta = 71; 24 + 71 = 95.
    const { result } = twoRoomSetup(24, 29);
    act(() => result.current.toggleGroupLock());
    act(() => result.current.setRoomVolume("uuid-B", 29 + 76));
    expect(result.current.vols["uuid-B"]).toBe(100);
    expect(result.current.vols["uuid-A"]).toBe(95);
  });

  it("clamps at floor: dragging down stops when any member hits 0", () => {
    // uuid-A at 5, uuid-B at 20. Drag uuid-B down by -30 → would be -10, clamps.
    // uuid-A has 5 headroom downward, uuid-B has 20.
    // Limiting delta = -5 (uuid-A hits 0 first).
    const { result } = twoRoomSetup(5, 20);
    act(() => result.current.toggleGroupLock());
    act(() => result.current.setRoomVolume("uuid-B", 20 - 30));
    expect(result.current.vols["uuid-A"]).toBe(0);
    expect(result.current.vols["uuid-B"]).toBe(15); // 20 + (-5) = 15
  });

  it("preserves integer offsets (no float drift) after multiple moves", () => {
    const { result } = twoRoomSetup(30, 40);
    act(() => result.current.toggleGroupLock());
    // Three successive gang moves
    act(() => result.current.setRoomVolume("uuid-A", 33));
    act(() => result.current.setRoomVolume("uuid-A", 36));
    act(() => result.current.setRoomVolume("uuid-A", 39));
    expect(result.current.vols["uuid-A"]).toBe(39);
    expect(result.current.vols["uuid-B"]).toBe(49);
    // All values are integers
    for (const v of Object.values(result.current.vols)) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe("useMixer — globalLock", () => {
  it("moves all rooms by the same delta when globalLock is on", () => {
    const { result } = twoRoomSetup(40, 60);
    act(() => result.current.setGlobalLock(true));
    act(() => result.current.setRoomVolume("uuid-A", 50));
    expect(result.current.vols["uuid-A"]).toBe(50);
    expect(result.current.vols["uuid-B"]).toBe(70);
  });

  it("setGlobalLock(false) disengages global gang", () => {
    const { result } = twoRoomSetup(40, 60);
    act(() => result.current.setGlobalLock(true));
    act(() => result.current.setGlobalLock(false));
    act(() => result.current.setRoomVolume("uuid-A", 50));
    expect(result.current.vols["uuid-A"]).toBe(50);
    expect(result.current.vols["uuid-B"]).toBe(60); // unchanged
  });
});

describe("useMixer — join / leave", () => {
  it("join adds a uuid to the gang member set", () => {
    const { result } = renderHook(() =>
      useMixer([{ coordinatorUuid: "uuid-A", name: "Room A", volume: 50, muted: false }]),
    );
    act(() => result.current.join("uuid-X"));
    expect(result.current.member["uuid-X"]).toBe(true);
  });

  it("leave removes a uuid from the gang member set", () => {
    const { result } = renderHook(() =>
      useMixer([{ coordinatorUuid: "uuid-A", name: "Room A", volume: 50, muted: false }]),
    );
    act(() => result.current.join("uuid-X"));
    act(() => result.current.leave("uuid-X"));
    expect(result.current.member["uuid-X"]).toBeFalsy();
  });
});

describe("useMixer — toggleMute", () => {
  it("flips a room's mute state", () => {
    const { result } = renderHook(() =>
      useMixer([{ coordinatorUuid: "uuid-A", name: "Room A", volume: 50, muted: false }]),
    );
    act(() => result.current.toggleMute("uuid-A"));
    expect(result.current.mutes["uuid-A"]).toBe(true);
    act(() => result.current.toggleMute("uuid-A"));
    expect(result.current.mutes["uuid-A"]).toBe(false);
  });
});

describe("useMixer — toggleGroupLock", () => {
  it("flips groupLock on/off", () => {
    const { result } = renderHook(() =>
      useMixer([{ coordinatorUuid: "uuid-A", name: "Room A", volume: 50, muted: false }]),
    );
    expect(result.current.groupLock).toBe(false);
    act(() => result.current.toggleGroupLock());
    expect(result.current.groupLock).toBe(true);
    act(() => result.current.toggleGroupLock());
    expect(result.current.groupLock).toBe(false);
  });
});

describe("useMixer — room removal / stale uuid cleanup (www-ddo9.2)", () => {
  it("removes stale room uuid from vols when room is removed from rooms prop", () => {
    const twoRooms = [
      { coordinatorUuid: "uuid-A", name: "Room A", volume: 40, muted: false },
      { coordinatorUuid: "uuid-B", name: "Room B", volume: 60, muted: false },
    ];
    const { result, rerender } = renderHook(({ rooms }) => useMixer(rooms), {
      initialProps: { rooms: twoRooms },
    });
    expect(Object.keys(result.current.vols)).toHaveLength(2);

    // uuid-B disconnects — remove it from rooms prop.
    rerender({ rooms: [{ coordinatorUuid: "uuid-A", name: "Room A", volume: 40, muted: false }] });

    expect(Object.keys(result.current.vols)).toHaveLength(1);
    expect(result.current.vols["uuid-B"]).toBeUndefined();
    expect(result.current.mutes["uuid-B"]).toBeUndefined();
  });

  it("gang-lock excludes disconnected room after removal", () => {
    const twoRooms = [
      { coordinatorUuid: "uuid-A", name: "Room A", volume: 40, muted: false },
      { coordinatorUuid: "uuid-B", name: "Room B", volume: 60, muted: false },
    ];
    const { result, rerender } = renderHook(({ rooms }) => useMixer(rooms), {
      initialProps: { rooms: twoRooms },
    });

    // Enable global lock.
    act(() => result.current.setGlobalLock(true));

    // uuid-B disconnects.
    rerender({ rooms: [{ coordinatorUuid: "uuid-A", name: "Room A", volume: 40, muted: false }] });

    // Drag uuid-A; only one room in state — solo path, no stale uuid-B movement.
    act(() => result.current.setRoomVolume("uuid-A", 50));
    expect(result.current.vols["uuid-A"]).toBe(50);
    expect(result.current.vols["uuid-B"]).toBeUndefined();
  });
});

describe("useMixer — dynamic rooms prop (www-51hf.49)", () => {
  it("re-syncs vols when a new room is added to the rooms prop", () => {
    // Start with one room.
    const initialRooms = [{ coordinatorUuid: "uuid-A", name: "Room A", volume: 40, muted: false }];
    const { result, rerender } = renderHook(({ rooms }) => useMixer(rooms), {
      initialProps: { rooms: initialRooms },
    });
    expect(result.current.vols["uuid-A"]).toBe(40);
    expect(result.current.vols["uuid-B"]).toBeUndefined();

    // A new Sonos speaker joins — rooms prop gains uuid-B.
    const updatedRooms = [
      { coordinatorUuid: "uuid-A", name: "Room A", volume: 40, muted: false },
      { coordinatorUuid: "uuid-B", name: "Room B", volume: 55, muted: true },
    ];
    rerender({ rooms: updatedRooms });

    expect(result.current.vols["uuid-B"]).toBe(55);
    expect(result.current.mutes["uuid-B"]).toBe(true);
  });

  it("new room participates in gang-lock after rooms prop update", () => {
    // Start with one room.
    const { result, rerender } = renderHook(({ rooms }) => useMixer(rooms), {
      initialProps: {
        rooms: [{ coordinatorUuid: "uuid-A", name: "Room A", volume: 40, muted: false }],
      },
    });

    // Enable global lock before new room arrives.
    act(() => result.current.setGlobalLock(true));

    // New room joins.
    rerender({
      rooms: [
        { coordinatorUuid: "uuid-A", name: "Room A", volume: 40, muted: false },
        { coordinatorUuid: "uuid-B", name: "Room B", volume: 60, muted: false },
      ],
    });

    // Drag uuid-A up by 5; uuid-B must also move by 5 (gang includes new room).
    act(() => result.current.setRoomVolume("uuid-A", 45));
    expect(result.current.vols["uuid-A"]).toBe(45);
    expect(result.current.vols["uuid-B"]).toBe(65);
  });
});
