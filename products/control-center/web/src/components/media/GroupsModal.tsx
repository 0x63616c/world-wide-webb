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

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { GroupsModalView } from "./GroupsModalView";
import { useGroupMembership } from "./hooks/useGroupMembership";
import type { GroupSource, SoundSystemRoom } from "./lib/derive-sources";
import { deriveSources, membershipByUuid } from "./lib/derive-sources";
import { BEAM_UUID } from "./lib/sonos-constants";

export interface GroupsModalProps {
  open: boolean;
  onClose: () => void;
  rooms: SoundSystemRoom[];
  dataUpdatedAt: number;
}

function defaultSourceId(sources: GroupSource[]): string {
  return sources.find((s) => s.playing)?.id ?? "src_desk_linein";
}

export function GroupsModal({ open, onClose, rooms, dataUpdatedAt }: GroupsModalProps) {
  const utils = trpc.useUtils();

  const sources = deriveSources(rooms);
  const polled = membershipByUuid(rooms);
  const { member, setMember } = useGroupMembership(polled, dataUpdatedAt);

  // Default selection is computed once at mount (first playing source, else the
  // Desk hardware card); afterwards it's purely user-driven via onSelectSource.
  const [selectedSourceId, setSelectedSourceId] = useState<string>(() => defaultSourceId(sources));

  const invalidate = () => {
    utils.media.soundSystem.invalidate();
  };

  const groupJoin = trpc.media.sonosGroupJoin.useMutation({ onSettled: invalidate });
  const groupLeave = trpc.media.sonosGroupLeave.useMutation({ onSettled: invalidate });
  const grabTv = trpc.media.sonosGrabTvToBeam.useMutation({ onSettled: invalidate });

  const selectedSource = sources.find((s) => s.id === selectedSourceId) ?? sources[0];

  // Join a single speaker to `source`. When the source is the TV and the beam
  // isn't already playing TV, the beam must first be "grabbed" onto the TV input
  // , awaited via mutateAsync so the subsequent join always targets a live TV
  // group, never a stale/idle beam coordinator.
  async function joinSpeaker(room: SoundSystemRoom, source: GroupSource) {
    setMember(room.uuid, source.id);

    if (source.kind === "tv") {
      const beamRoom = rooms.find((r) => r.uuid === BEAM_UUID);
      if (beamRoom && beamRoom.sourceKind !== "tv") {
        try {
          await grabTv.mutateAsync({ beamIp: beamRoom.deviceIp, beamUuid: BEAM_UUID });
        } catch (err) {
          // Surface the failed TV-grab so the join attempt (which still
          // follows) isn't silently mysterious; the mutation's own error
          // state is also available via grabTv.error for the UI.
          console.error("GroupsModal: sonosGrabTvToBeam failed", err);
        }
      }
    }

    groupJoin.mutate({ memberIp: room.deviceIp, coordinatorUuid: source.anchorUuid });
  }

  function onTapSpeaker(uuid: string) {
    const source = selectedSource;
    if (!source) return;
    // Anchor guard: the view already disables the anchor row, but the container
    // never emits a join/leave for it either.
    if (uuid === source.anchorUuid) return;
    const room = rooms.find((r) => r.uuid === uuid);
    if (!room) return;

    if (member[uuid] === source.id) {
      setMember(uuid, null);
      groupLeave.mutate({ memberIp: room.deviceIp, memberUuid: uuid });
      return;
    }

    void joinSpeaker(room, source);
  }

  function onAll() {
    const source = selectedSource;
    if (!source) return;
    // Skip any speaker that anchors a source (its own or another's) , anchoring
    // a source means it drives that group, so it can never be fanned INTO one.
    const anchorUuids = new Set(sources.map((s) => s.anchorUuid));
    for (const room of rooms) {
      if (anchorUuids.has(room.uuid)) continue;
      if (member[room.uuid] === source.id) continue;
      void joinSpeaker(room, source);
    }
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
      onAll={onAll}
    />
  );
}
