/**
 * useMixer hook , local volume/mute state plus the lock that moves rooms
 * together (www-51hf.14, lock semantics reworked to match the Hammerspoon
 * Sonos panel in dotfiles `hammerspoon/sonos.lua`).
 *
 * Holds local volume/mute state so the UI responds instantly while tRPC
 * writes propagate asynchronously. Volumes here are DISPLAY values: the
 * container converts the polled raw volume through each room's calibration
 * baseline on the way in and back to raw on the way out (see ../../calibration.ts).
 *
 * Lock algorithm:
 *   - globalLock ON  → every room snaps to the SAME displayed percentage as
 *     the one being moved.
 *   - else groupLock ON → the rooms sharing the moved room's coordinatorUuid
 *     snap to the same percentage.
 *   - else (unlocked) → only the moved room changes.
 *
 *  Matching PERCENTAGE (not raw volume, and not a preserved offset) is the
 *  point: once rooms are calibrated, "everything at 50%" is the balanced
 *  house, and each room reaches it through its own baseline. Without
 *  calibration the percentage is the raw volume, so the lock still behaves
 *  sensibly, just without the per-room correction.
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
  /** Display volume (percent of baseline, or raw when uncalibrated). */
  volume: number;
  muted: boolean;
}

/** A room's stable key: its own uuid, or its coordinatorUuid for solo groups. */
function roomKey(r: MixerRoom): string {
  return r.uuid ?? r.coordinatorUuid;
}

export interface MixerState {
  /** Current display volume per room key (uuid), integer. May exceed 100 when
   *  a room is past its calibrated ceiling; user-driven moves clamp to 0-100. */
  vols: Record<string, number>;
  /** True when ALL rooms are locked together. */
  globalLock: boolean;
  /** True when rooms sharing a coordinator are locked together. */
  groupLock: boolean;
  /** Mute state per room key. */
  mutes: Record<string, boolean>;
  /**
   * Move a room to a target display volume. Returns the rooms that changed
   * with their new display values (the moved room plus any locked with it),
   * so the caller can write each one through its own baseline.
   */
  setRoomVolume: (uuid: string, target: number) => Array<{ uuid: string; volume: number }>;
  /** Toggle the group lock on/off. */
  toggleGroupLock: () => void;
  /** Set globalLock explicitly. */
  setGlobalLock: (on: boolean) => void;
  /** Toggle a room's mute state locally. Returns the new muted value. */
  toggleMute: (uuid: string) => boolean;
}

function clamp(v: number): number {
  return Math.round(Math.max(0, Math.min(100, v)));
}

/**
 * @param rooms Polled room snapshot (display volumes).
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
  const [groupLock, setGroupLock] = useState(false);
  const [globalLock, setGlobalLockState] = useState(false);

  // Refs mirror the latest state so setRoomVolume can compute its result
  // synchronously (the caller writes it to the network) without stale closures.
  const volsRef = useRef(vols);
  volsRef.current = vols;
  const mutesRef = useRef(mutes);
  mutesRef.current = mutes;

  // roomKey → coordinatorUuid, kept current so setRoomVolume can gang a moved
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
    const reconcile = <T>(prev: Record<string, T>, pick: (r: MixerRoom) => T) => {
      const next = { ...prev };
      let changed = false;
      for (const r of rooms) {
        const key = roomKey(r);
        const polled = pick(r);
        if (!(key in next)) {
          next[key] = polled;
          changed = true;
        } else if (dataUpdatedAt > (lastEditAt.current[key] ?? 0) && next[key] !== polled) {
          next[key] = polled;
          changed = true;
        }
      }
      for (const uuid of Object.keys(next)) {
        if (!currentUuids.has(uuid)) {
          delete next[uuid];
          changed = true;
        }
      }
      // Return prev UNCHANGED when nothing changed so the state reference stays
      // stable and React skips the re-render (www-w6ug infinite-render guard).
      return changed ? next : prev;
    };
    setVols((prev) => reconcile(prev, (r) => r.volume));
    setMutes((prev) => reconcile(prev, (r) => r.muted));
  }, [rooms, dataUpdatedAt]);

  const setRoomVolume = useCallback(
    (uuid: string, target: number) => {
      const prev = volsRef.current;
      // Locks are the ONLY thing that gangs faders: globalLock first, then
      // groupLock (coordinator group only), then solo.
      let gang: string[];
      if (globalLock) {
        gang = Object.keys(prev);
      } else if (groupLock) {
        const coord = groupOf.current[uuid];
        gang = coord ? Object.keys(prev).filter((u) => groupOf.current[u] === coord) : [uuid];
      } else {
        gang = [uuid];
      }
      if (!gang.includes(uuid)) gang.push(uuid);

      const value = clamp(target);
      const changed: Array<{ uuid: string; volume: number }> = [];
      const now = Date.now();
      const next = { ...prev };
      for (const u of gang) {
        if (next[u] === value) continue;
        next[u] = value;
        // www-tavs: stamp lastEditAt for every room actually changed so the
        // [rooms] reconcile effect won't overwrite them during cooldown.
        lastEditAt.current[u] = now;
        changed.push({ uuid: u, volume: value });
      }
      if (changed.length > 0) {
        volsRef.current = next;
        setVols(next);
      }
      return changed;
    },
    [globalLock, groupLock],
  );

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
    const next = !mutesRef.current[uuid];
    mutesRef.current = { ...mutesRef.current, [uuid]: next };
    setMutes(mutesRef.current);
    return next;
  }, []);

  return {
    vols,
    globalLock,
    groupLock,
    mutes,
    setRoomVolume,
    toggleGroupLock,
    setGlobalLock,
    toggleMute,
  };
}
