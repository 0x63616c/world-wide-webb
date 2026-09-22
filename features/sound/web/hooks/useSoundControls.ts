/**
 * useSoundControls , the one container hook behind both Sound System surfaces
 * (the 4×3 tile face and the full-page detail view).
 *
 * Owns: the polled `sound.soundSystem` query (same key on both surfaces, so
 * react-query dedupes the fetch), the local mixer (display volumes + locks),
 * the throttled raw volume writes, and every mutation the page exposes:
 * mute, calibrate / clear calibration, join-all-to-Desk, TV mode, and the
 * per-room join / make-standalone moves.
 *
 * Volumes cross this hook in DISPLAY space (percent of each room's
 * calibration baseline, raw when uncalibrated); the conversion to the raw
 * value Home Assistant wants happens here, once, on the way out.
 */

import { useCallback, useMemo, useState } from "react";
import { POLL } from "@/lib/hooks";
import type { RouterOutputs } from "@/lib/trpc";
import { trpc } from "@/lib/trpc";
import { displayVolume, rawVolume } from "../../calibration";
import { useMixer } from "./useMixer";
import { useThrottledVolume } from "./useThrottledVolume";

export type SoundRoom = RouterOutputs["sound"]["soundSystem"]["rooms"][number];

/** Every room joins the Desk pair's group (the room named this). */
export const DESK_ROOM_NAME = "Desk";
/** Fallback TV room when no room is currently on its TV input (the Beam). */
const TV_ROOM_NAME = "Living Room";

/** Volume step for the +/- buttons. One point is the grainy control the steppers exist for. */
const VOLUME_STEP = 1;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Home Assistant command failed";
}

function byName(rooms: SoundRoom[], name: string): SoundRoom | undefined {
  return rooms.find(
    (room) =>
      room.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase() &&
      room.availability === "available",
  );
}

/**
 * The room "everything to the TV" gathers onto: the room currently playing
 * its TV/optical input, else the Living Room (the Beam, the one speaker
 * wired to a TV) when it is online.
 */
function findTvRoom(rooms: SoundRoom[]): SoundRoom | undefined {
  return (
    rooms.find((room) => room.sourceKind === "tv" && room.availability === "available") ??
    byName(rooms, TV_ROOM_NAME)
  );
}

/** Available rooms not already in `target`'s group. */
function roomsToJoin(rooms: SoundRoom[], target: SoundRoom | undefined): SoundRoom[] {
  if (!target) return [];
  return rooms.filter(
    (room) =>
      room.availability === "available" &&
      room.uuid !== target.uuid &&
      room.coordinatorUuid !== target.coordinatorUuid,
  );
}

interface JoinAllTarget {
  /** The room being gathered onto, when it is online. */
  room: SoundRoom | undefined;
  /** Rooms the action would move. Empty when everything is already there. */
  pending: SoundRoom[];
  isPending: boolean;
  run: () => void;
}

export interface SoundControls {
  status: "loading" | "error" | "populated";
  rooms: SoundRoom[];
  /** When the snapshot was fetched (react-query dataUpdatedAt). */
  dataUpdatedAt: number;
  queryError: string | null;
  /** Display volume per room uuid. */
  vols: Record<string, number>;
  mutes: Record<string, boolean>;
  globalLock: boolean;
  groupLock: boolean;
  /** Rooms with a stored baseline. */
  calibratedCount: number;
  /** Set a room's display volume (slider). Locked rooms follow. */
  setVolume: (uuid: string, display: number) => void;
  /** Nudge a room by ±VOLUME_STEP (the +/- buttons). Locked rooms follow. */
  stepVolume: (uuid: string, direction: 1 | -1) => void;
  toggleMute: (uuid: string) => void;
  setGlobalLock: (on: boolean) => void;
  toggleGroupLock: () => void;
  calibrate: { run: () => void; isPending: boolean };
  clearCalibration: { run: () => void; isPending: boolean };
  joinAllToDesk: JoinAllTarget;
  joinAllToTv: JoinAllTarget;
  join: (room: SoundRoom, coordinatorUuid: string) => void;
  leave: (room: SoundRoom) => void;
  /** Last failed command, if any. */
  error: string | null;
  /** Last informational notice (e.g. "calibrated 5 rooms"). */
  notice: string | null;
}

export function useSoundControls(): SoundControls {
  const utils = trpc.useUtils();
  const query = trpc.sound.soundSystem.useQuery(undefined, {
    refetchInterval: POLL.soundSystem,
  });
  const { dataUpdatedAt } = query;
  const rooms = useMemo(() => query.data?.rooms ?? [], [query.data]);
  const status: SoundControls["status"] =
    query.data != null ? "populated" : query.isError ? "error" : "loading";

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const invalidate = useCallback(() => void utils.sound.soundSystem.invalidate(), [utils]);
  const fail = useCallback((e: unknown) => setError(errorMessage(e)), []);

  // ── Mixer over DISPLAY volumes ─────────────────────────────────────────────
  const mixerRooms = useMemo(
    () =>
      rooms.map((r) => ({
        uuid: r.uuid,
        coordinatorUuid: r.coordinatorUuid,
        name: r.name,
        volume: displayVolume(r.volume, r.baseline),
        muted: r.muted,
      })),
    [rooms],
  );
  const mixer = useMixer(mixerRooms, dataUpdatedAt);

  const setVolMutation = trpc.sound.sonosSetVolume.useMutation({ onError: fail });
  // www-83z4: throttle the network write to ~200ms (leading + trailing) so a
  // fader drag sends at most ~1 write per 200ms per speaker.
  const writeVolume = useThrottledVolume(
    useCallback(
      (deviceIp: string, volume: number) => {
        setVolMutation.mutate({ deviceIp, volume });
      },
      [setVolMutation],
    ),
  );

  const baselineOf = useMemo(
    () => Object.fromEntries(rooms.map((r) => [r.uuid, r.baseline])),
    [rooms],
  );
  const deviceOf = useMemo(
    () => Object.fromEntries(rooms.map((r) => [r.uuid, r.deviceIp])),
    [rooms],
  );

  const setVolume = useCallback(
    (uuid: string, display: number) => {
      // Local state is instant; each changed room (the moved one plus any
      // locked with it) is written through ITS OWN baseline , matching
      // percentage, not matching raw volume.
      for (const changed of mixer.setRoomVolume(uuid, display)) {
        const deviceIp = deviceOf[changed.uuid];
        if (deviceIp) writeVolume(deviceIp, rawVolume(changed.volume, baselineOf[changed.uuid]));
      }
    },
    [mixer.setRoomVolume, deviceOf, baselineOf, writeVolume],
  );

  const stepVolume = useCallback(
    (uuid: string, direction: 1 | -1) => {
      const current = mixer.vols[uuid];
      if (current === undefined) return;
      setVolume(uuid, current + direction * VOLUME_STEP);
    },
    [mixer.vols, setVolume],
  );

  const setMuteMutation = trpc.sound.sonosSetMute.useMutation({ onError: fail });
  const toggleMute = useCallback(
    (uuid: string) => {
      const muted = mixer.toggleMute(uuid);
      const deviceIp = deviceOf[uuid];
      if (deviceIp) setMuteMutation.mutate({ deviceIp, muted });
    },
    [mixer.toggleMute, deviceOf, setMuteMutation],
  );

  // ── Calibration ────────────────────────────────────────────────────────────
  const calibrateMutation = trpc.sound.sonosCalibrate.useMutation({
    onMutate: () => {
      setError(null);
      setNotice(null);
    },
    onSuccess: (written) => {
      const n = Object.keys(written).length;
      setNotice(
        n === 0
          ? "Nothing to calibrate: every room is silent."
          : `Calibrated ${n} room${n === 1 ? "" : "s"}. Each now reads 50%.`,
      );
      invalidate();
    },
    onError: fail,
  });
  const clearMutation = trpc.sound.sonosClearCalibration.useMutation({
    onMutate: () => {
      setError(null);
      setNotice(null);
    },
    onSuccess: () => {
      // Matching percentages stop meaning anything with no calibration
      // behind them, so the lock goes with it (as in the Hammerspoon panel).
      mixer.setGlobalLock(false);
      setNotice("Calibration cleared. Showing raw volume.");
      invalidate();
    },
    onError: fail,
  });

  // ── Grouping ───────────────────────────────────────────────────────────────
  const joinAllMutation = trpc.sound.sonosGroupJoinAll.useMutation({
    onMutate: () => {
      setError(null);
      setNotice(null);
    },
    onSuccess: () => {
      setNotice("Join command sent. Refreshing group status…");
      invalidate();
    },
    onError: fail,
  });
  const tvMutation = trpc.sound.sonosGroupJoinAllToTv.useMutation({
    onMutate: () => {
      setError(null);
      setNotice(null);
    },
    onSuccess: () => {
      setNotice("TV mode sent. Refreshing group status…");
      invalidate();
    },
    onError: fail,
  });
  const joinMutation = trpc.sound.sonosGroupJoin.useMutation({
    onSuccess: invalidate,
    onError: fail,
  });
  const leaveMutation = trpc.sound.sonosGroupLeave.useMutation({
    onSuccess: invalidate,
    onError: fail,
  });

  const desk = byName(rooms, DESK_ROOM_NAME);
  const deskPending = roomsToJoin(rooms, desk);
  const tv = findTvRoom(rooms);
  // TV mode makes the TV room the leader. When it is currently FOLLOWING
  // another room, its group-mates are not "already there": they must be
  // re-joined under it, so every other online room is pending.
  const tvPending = tv?.isCoordinator
    ? roomsToJoin(rooms, tv)
    : rooms.filter((room) => room.availability === "available" && room.uuid !== tv?.uuid);

  const calibratedCount = rooms.filter((r) => r.baseline !== null).length;

  return {
    status,
    rooms,
    dataUpdatedAt,
    queryError: query.isError ? errorMessage(query.error) : null,
    vols: mixer.vols,
    mutes: mixer.mutes,
    globalLock: mixer.globalLock,
    groupLock: mixer.groupLock,
    calibratedCount,
    setVolume,
    stepVolume,
    toggleMute,
    setGlobalLock: mixer.setGlobalLock,
    toggleGroupLock: mixer.toggleGroupLock,
    calibrate: {
      run: () => calibrateMutation.mutate(undefined),
      isPending: calibrateMutation.isPending,
    },
    clearCalibration: {
      run: () => clearMutation.mutate(undefined),
      isPending: clearMutation.isPending,
    },
    joinAllToDesk: {
      room: desk,
      pending: deskPending,
      isPending: joinAllMutation.isPending,
      run: () => {
        if (!desk || deskPending.length === 0) return;
        joinAllMutation.mutate({
          coordinatorEntityId: desk.coordinatorUuid,
          memberEntityIds: deskPending.map((room) => room.deviceIp),
        });
      },
    },
    joinAllToTv: {
      room: tv,
      pending: tvPending,
      isPending: tvMutation.isPending,
      run: () => {
        if (!tv) return;
        // Unlike Desk, TV mode is worth sending even with nobody to join: it
        // also puts the TV room back on its TV input.
        tvMutation.mutate({
          tvEntityId: tv.deviceIp,
          memberEntityIds: tvPending.map((room) => room.deviceIp),
        });
      },
    },
    join: (room, coordinatorUuid) =>
      joinMutation.mutate({ memberIp: room.deviceIp, coordinatorUuid }),
    leave: (room) => leaveMutation.mutate({ memberIp: room.deviceIp, memberUuid: room.uuid }),
    error,
    notice,
  };
}
