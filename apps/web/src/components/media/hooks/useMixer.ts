/**
 * useMixer hook — gang-lock algorithm for multi-room volume control (CC-51hf.14).
 *
 * Shared by the Sound System tile and Mixer modal. Holds local volume/mute state
 * so the UI responds instantly while tRPC writes propagate asynchronously.
 *
 * Gang-lock algorithm:
 *  When groupLock OR globalLock is active, dragging any fader moves ALL known
 *  rooms by the same integer delta. The gang STOPS when any member would
 *  breach 0 or 100 — the delta is clamped to the tightest headroom across
 *  all members, preserving relative offsets (not absolute values).
 *
 *  The `member` map tracks which rooms have been explicitly added to the group
 *  via join() — used by the UI to show group membership; the lock modes operate
 *  on all known rooms for simplicity (the wall panel is a single Sonos household).
 *
 * Why integer clamping: Sonos volume is 0-100 integer; float drift accumulates
 * across successive moves and can cause off-by-one mismatches with the device.
 */

import { useCallback, useEffect, useState } from "react";

export interface MixerRoom {
  coordinatorUuid: string;
  name: string;
  volume: number;
  muted: boolean;
}

export interface MixerState {
  /** Current volume per coordinatorUuid, 0-100 integer. */
  vols: Record<string, number>;
  /** Gang member set: uuid → true when participating in the group lock. */
  member: Record<string, boolean>;
  /** True when ALL rooms are locked together (global gang). */
  globalLock: boolean;
  /** True when the group lock is active (locks all known rooms). */
  groupLock: boolean;
  /** Mute state per coordinatorUuid. */
  mutes: Record<string, boolean>;
  /** Set a fader to a target value; applies gang-lock delta if active. */
  setRoomVolume: (uuid: string, target: number) => void;
  /** Add a uuid to the gang member set. */
  join: (uuid: string) => void;
  /** Remove a uuid from the gang member set. */
  leave: (uuid: string) => void;
  /** Toggle the group lock on/off. */
  toggleGroupLock: () => void;
  /** Set globalLock explicitly. */
  setGlobalLock: (on: boolean) => void;
  /** Toggle a room's mute state. */
  toggleMute: (uuid: string) => void;
}

function clamp(v: number): number {
  return Math.round(Math.max(0, Math.min(100, v)));
}

/**
 * Apply the gang-lock algorithm to a map of volumes.
 * The dragged fader requests `target`; the actual delta is capped so no
 * member exceeds [0, 100]. All gang members move by the same capped integer delta.
 */
function applyGangDelta(
  vols: Record<string, number>,
  gangUuids: string[],
  draggedUuid: string,
  target: number,
): Record<string, number> {
  const currentDragged = vols[draggedUuid] ?? 0;
  const rawDelta = Math.round(target) - currentDragged;
  if (rawDelta === 0) return vols;

  // Find the tightest headroom across all gang members in the direction of movement.
  let cappedDelta = rawDelta;
  for (const uuid of gangUuids) {
    const current = vols[uuid] ?? 0;
    if (rawDelta > 0) {
      // Moving up: headroom = 100 - current
      cappedDelta = Math.min(cappedDelta, 100 - current);
    } else {
      // Moving down: headroom = -(current - 0) = -current
      cappedDelta = Math.max(cappedDelta, -current);
    }
  }

  if (cappedDelta === 0) return vols;

  const next = { ...vols };
  for (const uuid of gangUuids) {
    next[uuid] = clamp((vols[uuid] ?? 0) + cappedDelta);
  }
  return next;
}

export function useMixer(rooms: MixerRoom[]): MixerState {
  const [vols, setVols] = useState<Record<string, number>>(() =>
    Object.fromEntries(rooms.map((r) => [r.coordinatorUuid, r.volume])),
  );
  const [mutes, setMutes] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(rooms.map((r) => [r.coordinatorUuid, r.muted])),
  );
  const [member, setMember] = useState<Record<string, boolean>>({});
  const [groupLock, setGroupLock] = useState(false);
  const [globalLock, setGlobalLockState] = useState(false);

  // Re-sync vols and mutes when the rooms array changes: seed new rooms and prune
  // removed ones. Without pruning, stale uuids linger in state and the gang-lock
  // applies deltas to disconnected speakers (CC-ddo9.2).
  useEffect(() => {
    const currentUuids = new Set(rooms.map((r) => r.coordinatorUuid));
    setVols((prev) => {
      const next = { ...prev };
      let changed = false;
      // Seed new rooms.
      for (const r of rooms) {
        if (!(r.coordinatorUuid in next)) {
          next[r.coordinatorUuid] = r.volume;
          changed = true;
        }
      }
      // Prune rooms that are no longer in the prop.
      for (const uuid of Object.keys(next)) {
        if (!currentUuids.has(uuid)) {
          delete next[uuid];
          changed = true;
        }
      }
      // Return prev UNCHANGED when nothing was seeded or pruned so the state
      // reference stays stable and React skips the re-render. Without this, a
      // caller passing a fresh rooms array each render (e.g. an inline literal)
      // would make the [rooms] effect fire every render, return a new object,
      // and re-render forever — a loop React only caps via max-update-depth, but
      // which explodes coverage time/memory in CI (CC-w6ug).
      return changed ? next : prev;
    });
    setMutes((prev) => {
      const next = { ...prev };
      let changed = false;
      // Seed new rooms.
      for (const r of rooms) {
        if (!(r.coordinatorUuid in next)) {
          next[r.coordinatorUuid] = r.muted;
          changed = true;
        }
      }
      // Prune rooms that are no longer in the prop.
      for (const uuid of Object.keys(next)) {
        if (!currentUuids.has(uuid)) {
          delete next[uuid];
          changed = true;
        }
      }
      // Same stable-reference guard as setVols above (CC-w6ug).
      return changed ? next : prev;
    });
  }, [rooms]);

  const setRoomVolume = useCallback(
    (uuid: string, target: number) => {
      setVols((prev) => {
        // Both groupLock and globalLock lock all known rooms together.
        if (groupLock || globalLock) {
          const allUuids = Object.keys(prev);
          if (allUuids.length > 1) {
            return applyGangDelta(prev, allUuids, uuid, target);
          }
        }
        // Solo fader — clamp and update only this room.
        return { ...prev, [uuid]: clamp(target) };
      });
    },
    [globalLock, groupLock],
  );

  const join = useCallback((uuid: string) => {
    setMember((prev) => ({ ...prev, [uuid]: true }));
  }, []);

  const leave = useCallback((uuid: string) => {
    setMember((prev) => {
      const next = { ...prev };
      delete next[uuid];
      return next;
    });
  }, []);

  const toggleGroupLock = useCallback(() => {
    setGroupLock((prev) => !prev);
  }, []);

  const setGlobalLock = useCallback((on: boolean) => {
    setGlobalLockState(on);
  }, []);

  const toggleMute = useCallback((uuid: string) => {
    setMutes((prev) => ({ ...prev, [uuid]: !prev[uuid] }));
  }, []);

  return {
    vols,
    member,
    globalLock,
    groupLock,
    mutes,
    setRoomVolume,
    join,
    leave,
    toggleGroupLock,
    setGlobalLock,
    toggleMute,
  };
}
