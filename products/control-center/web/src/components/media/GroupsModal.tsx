/**
 * GroupsModal , container for the Sonos Groups modal (www-51hf, Task 7).
 *
 * Wires the pure derivation (deriveSources/membershipByUuid, Tasks 5/6) and the
 * optimistic membership hook (useGroupMembership, www-tavs-style stale-poll
 * reconcile) to the presentational GroupsModalView. Owns the tRPC mutations:
 * sonosGroupJoin/sonosGroupLeave for join/leave, sonosGrabTvToBeam for the
 * TV-hijack step that must land BEFORE a join targets the TV source.
 *
 * rooms/dataUpdatedAt are passed down from SoundSystemTile's existing
 * media.soundSystem query , this container does NOT run a second poll.
 */

import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { GroupsModalView } from "./GroupsModalView";
import { useGroupMembership } from "./hooks/useGroupMembership";
import type { GroupSource, SoundSystemRoom } from "./lib/derive-sources";
import { deriveSources, membershipByUuid } from "./lib/derive-sources";
import { BEAM_UUID, DESK_LINE_IN_UUID } from "./lib/sonos-constants";

export interface GroupsModalProps {
  open: boolean;
  onClose: () => void;
  rooms: SoundSystemRoom[];
  dataUpdatedAt: number;
}

function defaultSourceId(sources: GroupSource[]): string {
  return sources.find((s) => s.playing)?.id ?? "src_desk_linein";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}

export function GroupsModal({ open, onClose, rooms, dataUpdatedAt }: GroupsModalProps) {
  const utils = trpc.useUtils();

  const sources = deriveSources(rooms);
  const polled = useMemo(() => membershipByUuid(rooms), [rooms]);
  const { member, setMember } = useGroupMembership(polled, dataUpdatedAt);

  // Default selection (first playing source, else the Desk hardware card) is
  // recomputed every time the modal transitions to open, not just at mount ,
  // otherwise a stale selection from a previous open lingers.
  const [selectedSourceId, setSelectedSourceId] = useState<string>(() => defaultSourceId(sources));
  const [errorText, setErrorText] = useState<string | null>(null);

  // Only the open-rising-edge should reset selection; `sources` is
  // intentionally excluded so a live poll update never yanks the user's
  // manual selection while the modal is open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (open) setSelectedSourceId(defaultSourceId(sources));
  }, [open]);

  const invalidate = () => {
    utils.media.soundSystem.invalidate();
  };

  const onMutationError = (err: unknown) => setErrorText(errorMessage(err));

  const groupJoin = trpc.media.sonosGroupJoin.useMutation({
    onSettled: invalidate,
    onError: onMutationError,
  });
  const groupLeave = trpc.media.sonosGroupLeave.useMutation({
    onSettled: invalidate,
    onError: onMutationError,
  });
  const grabTv = trpc.media.sonosGrabTvToBeam.useMutation({ onSettled: invalidate });
  const setLineIn = trpc.media.sonosSetLineIn.useMutation({ onSettled: invalidate });

  const selectedSource = sources.find((s) => s.id === selectedSourceId) ?? sources[0];

  // Grabs the hardware jack (TV or Desk line-in) onto its floor card, awaited
  // so a subsequent join always targets a live hardware group, never a
  // stale/idle coordinator , mirrors the TV-grab-before-join path for both
  // hardware cards. Returns false (and surfaces errorText) on failure so the
  // caller aborts instead of joining into a source that never actually grabbed.
  async function grabHardwareIfNeeded(source: GroupSource): Promise<boolean> {
    if (source.kind === "tv") {
      const beamRoom = rooms.find((r) => r.uuid === BEAM_UUID);
      if (beamRoom && beamRoom.sourceKind !== "tv") {
        try {
          await grabTv.mutateAsync({ beamIp: beamRoom.deviceIp, beamUuid: BEAM_UUID });
        } catch (err) {
          setErrorText(errorMessage(err));
          return false;
        }
      }
    } else if (source.id === "src_desk_linein") {
      const deskRoom = rooms.find((r) => r.uuid === DESK_LINE_IN_UUID);
      if (deskRoom && deskRoom.sourceKind !== "line-in") {
        try {
          await setLineIn.mutateAsync({
            deviceIp: deskRoom.deviceIp,
            sourceUuid: DESK_LINE_IN_UUID,
          });
        } catch (err) {
          setErrorText(errorMessage(err));
          return false;
        }
      }
    }
    return true;
  }

  // Join a single speaker to `source`. Assumes any hardware-jack grab this
  // source needed has already landed (grabHardwareIfNeeded , called once by
  // the caller, not per-speaker; see onAll). Reverts the optimistic LED if the
  // join mutation itself fails.
  function joinSpeaker(room: SoundSystemRoom, source: GroupSource) {
    const previous = member[room.uuid] ?? null;
    setMember(room.uuid, source.id);
    groupJoin.mutate(
      { memberIp: room.deviceIp, coordinatorUuid: source.anchorUuid },
      { onError: () => setMember(room.uuid, previous) },
    );
  }

  async function joinSpeakerWithGrab(room: SoundSystemRoom, source: GroupSource) {
    const grabbed = await grabHardwareIfNeeded(source);
    if (!grabbed) return;
    joinSpeaker(room, source);
  }

  function onTapSpeaker(uuid: string) {
    const source = selectedSource;
    if (!source) return;
    const room = rooms.find((r) => r.uuid === uuid);
    if (!room) return;

    // Anchor guard: a standalone anchor (or one driving this source) can't
    // join or leave its own source , no-op, mirroring the view's disabled row.
    // But an anchor CAPTURED by another group (e.g. Desk joined into the TV
    // group) must stay actionable: tapping it releases it back to standalone,
    // where membership maps it to its own hardware card again.
    if (uuid === source.anchorUuid) {
      const followed = member[uuid] ?? null;
      if (followed == null || followed === source.id) return;
      setMember(uuid, source.id);
      groupLeave.mutate(
        { memberIp: room.deviceIp, memberUuid: uuid },
        { onError: () => setMember(uuid, followed) },
      );
      return;
    }

    if (member[uuid] === source.id) {
      const previous = member[uuid] ?? null;
      setMember(uuid, null);
      groupLeave.mutate(
        { memberIp: room.deviceIp, memberUuid: uuid },
        { onError: () => setMember(uuid, previous) },
      );
      return;
    }

    void joinSpeakerWithGrab(room, source);
  }

  return (
    <GroupsModalView
      open={open}
      onClose={onClose}
      sources={sources}
      member={member}
      speakers={rooms.map((r) => ({ uuid: r.uuid, name: r.name }))}
      selectedSourceId={selectedSource?.id ?? "src_desk_linein"}
      onSelectSource={setSelectedSourceId}
      onTapSpeaker={onTapSpeaker}
      errorText={errorText}
    />
  );
}
