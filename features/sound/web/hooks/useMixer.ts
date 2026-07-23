/**
 * useMixer hook , gang-lock algorithm for multi-room volume control (www-51hf.14).
 *
 * Shared by the Sound System tile and Mixer modal. Holds local volume/mute state
 * so the UI responds instantly while tRPC writes propagate asynchronously.
 *
 * Gang-lock algorithm (www-ecc2):
 *  Locks are the ONLY thing that gangs faders:
 *   - globalLock ON  → gang = ALL rooms.
 *   - else groupLock ON → gang = rooms sharing the dragged room's coordinatorUuid.
 *   - else (unlocked) → gang = [uuid] ONLY (solo move, even for a grouped room).
 *
 *  The gang STOPS when any member would breach 0 or 100 , the delta is clamped
 *  to the tightest headroom across all members, preserving relative offsets.
 *
 *  The `member` map tracks which rooms have been explicitly added to the group
 *  via join() , used by the UI to show group membership.
 *
 * Why integer clamping: Sonos volume is 0-100 integer; float drift accumulates
 * across successive moves and can cause off-by-one mismatches with the device.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface MixerRoom {
  /**
   * This room's own identity key. Defaults to coordinatorUuid when omitted (a
   * solo, single-speaker group), which keeps single-room callers/tests working.
   */
  uuid?: string;
  /** Coordinator UUID of this room's group , rooms sharing it gang together. */
  coordinatorUuid: string;
  name: string;
  volume: number;
  muted: boolean;
}

/** A room's stable key: its own uuid, or its coordinatorUuid for solo groups. */
function roomKey(r: MixerRoom): string {
  return r.uuid ?? r.coordinatorUuid;
}

export interface MixerState {
  /** Current volume per room key (uuid), 0-100 integer. */
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

/**
 * @param rooms Polled room snapshot from media.soundSystem.
 * @param dataUpdatedAt When that snapshot was FETCHED (react-query dataUpdatedAt,
 *   epoch ms; 0 while no data). Reconciliation is gated on it: a snapshot may
 *   only overwrite a room it was fetched after that room's last local edit.
 */
export function useMixer(rooms: MixerRoom[], dataUpdatedAt: number): MixerState {
  const [vols, setVols] = useState<Record<string, number>>(() =>
    Object.fromEntries(rooms.map((r) => [roomKey(r), r.volume])),
  );
  const [mutes, setMutes] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(rooms.map((r) => [roomKey(r), r.muted])),
  );
  const [member, setMember] = useState<Record<string, boolean>>({});
  const [groupLock, setGroupLock] = useState(false);
  const [globalLock, setGlobalLockState] = useState(false);

  // roomKey → coordinatorUuid, kept current so setRoomVolume can gang a dragged
  // fader with its group-mates without re-subscribing the callback. A ref (not
  // state) so updating it never triggers a render , avoiding the www-w6ug loop.
  const groupOf = useRef<Record<string, string>>({});
  groupOf.current = Object.fromEntries(rooms.map((r) => [roomKey(r), r.coordinatorUuid]));

  // www-tavs: tracks the last time a local edit (setRoomVolume / toggleMute) was
  // made for each roomKey. A polled snapshot only overwrites a room when it was
  // fetched AFTER that room's last local edit (dataUpdatedAt > lastEditAt) , a
  // stale cached snapshot replayed by an unrelated re-render (e.g. dragging a
  // second fader) can never snap an edited fader back.
  const lastEditAt = useRef<Record<string, number>>({});

  // Re-sync vols and mutes when the rooms array changes (www-tavs):
  //  - Seed new rooms (vol + mute from the poll, they have no local edit yet).
  //  - Prune rooms no longer in the prop (www-ddo9.2).
  //  - For EXISTING rooms, overwrite vol/mute from the poll only when the poll
  //    was fetched after the room's last local edit , desired-vs-reported
  //    reconcile that a stale snapshot can never win.
  useEffect(() => {
    const currentUuids = new Set(rooms.map((r) => roomKey(r)));
    setVols((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const r of rooms) {
        const key = roomKey(r);
        if (!(key in next)) {
          // New room: seed from poll.
          next[key] = r.volume;
          changed = true;
        } else if (dataUpdatedAt > (lastEditAt.current[key] ?? 0)) {
          // Existing room, snapshot fetched after the last local edit:
          // reconcile from poll if value differs.
          if (next[key] !== r.volume) {
            next[key] = r.volume;
            changed = true;
          }
        }
        // Snapshot older than the local edit: leave the local value untouched.
      }
      // Prune rooms that are no longer in the prop.
      for (const uuid of Object.keys(next)) {
        if (!currentUuids.has(uuid)) {
          delete next[uuid];
          changed = true;
        }
      }
      // Return prev UNCHANGED when nothing changed so the state reference stays
      // stable and React skips the re-render (www-w6ug infinite-render guard).
      return changed ? next : prev;
    });
    setMutes((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const r of rooms) {
        const key = roomKey(r);
        if (!(key in next)) {
          // New room: seed from poll.
          next[key] = r.muted;
          changed = true;
        } else if (dataUpdatedAt > (lastEditAt.current[key] ?? 0)) {
          // Existing room, snapshot fetched after the last local edit:
          // reconcile from poll if value differs.
          if (next[key] !== r.muted) {
            next[key] = r.muted;
            changed = true;
          }
        }
        // Snapshot older than the local edit: leave the local value untouched.
      }
      // Prune rooms that are no longer in the prop.
      for (const uuid of Object.keys(next)) {
        if (!currentUuids.has(uuid)) {
          delete next[uuid];
          changed = true;
        }
      }
      // Same stable-reference guard as setVols above (www-w6ug).
      return changed ? next : prev;
    });
  }, [rooms, dataUpdatedAt]);

  const setRoomVolume = useCallback(
    (uuid: string, target: number) => {
      setVols((prev) => {
        // www-ecc2: locks are the ONLY thing that gangs faders.
        // globalLock first, then groupLock (coordinator group only), then solo.
        let gang: string[];
        if (globalLock) {
          gang = Object.keys(prev);
        } else if (groupLock) {
          const coord = groupOf.current[uuid];
          gang = coord ? Object.keys(prev).filter((u) => groupOf.current[u] === coord) : [uuid];
        } else {
          // Unlocked , solo move regardless of coordinatorUuid.
          gang = [uuid];
        }

        // www-tavs: stamp lastEditAt for every room actually changed so the
        // [rooms] reconcile effect won't overwrite them during cooldown.
        const now = Date.now();
        for (const u of gang) {
          lastEditAt.current[u] = now;
        }

        if (gang.length > 1) {
          return applyGangDelta(prev, gang, uuid, target);
        }
        // Solo fader , clamp and update only this room.
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
    // www-tavs: stamp lastEditAt so the [rooms] reconcile doesn't overwrite
    // a local mute toggle within the cooldown window.
    lastEditAt.current[uuid] = Date.now();
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
