/**
 * SoundSystemTile , container for the Sound System 4×3 tile (www-51hf.18 / A22).
 *
 * Resolves media.soundSystem via tRPC with a 10s poll (topology + volume changes
 * are infrequent). Renders Skeleton while pending/error (A18). On success passes
 * all rooms to useMixer for local gang-lock state, then renders SoundSystemTileView.
 *
 * Opens MixerModal on expand. Opens SourceModal when a room name is tapped
 * (A25/A31) , selecting Line-in writes the room's source via sonosSetLineIn.
 */

import { useCallback, useState } from "react";
import { trpc } from "@/lib/trpc";
import { GroupsModal } from "./GroupsModal";
import { useMixer } from "./hooks/useMixer";
import { useThrottledVolume } from "./hooks/useThrottledVolume";
import { MixerModal } from "./MixerModal";
import { SoundSystemTileView } from "./SoundSystemTileView";
import { SourceModal } from "./SourceModal";

const SOUND_POLL_MS = 10_000;

export function SoundSystemTile() {
  // dataUpdatedAt gates useMixer's reconcile: only a snapshot fetched after a
  // fader's last local edit may overwrite it (www-tavs stale-poll snap-back).
  const { data, isError, dataUpdatedAt } = trpc.media.soundSystem.useQuery(undefined, {
    refetchInterval: SOUND_POLL_MS,
  });

  const [mixerOpen, setMixerOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);

  const setVolMutation = trpc.media.sonosSetVolume.useMutation();
  const setMuteMutation = trpc.media.sonosSetMute.useMutation();

  // www-83z4: throttle the network write to ~200ms (leading + trailing) so a
  // fader drag sends at most ~1 UPnP write per 200ms per speaker.
  const writeVolume = useThrottledVolume(
    useCallback(
      (deviceIp: string, volume: number) => {
        setVolMutation.mutate({ deviceIp, volume });
      },
      [setVolMutation],
    ),
  );
  const groupJoinMutation = trpc.media.sonosGroupJoin.useMutation();
  const groupLeaveMutation = trpc.media.sonosGroupLeave.useMutation();
  const setLineInMutation = trpc.media.sonosSetLineIn.useMutation();

  const rooms = data?.rooms ?? [];

  const mixer = useMixer(
    rooms.map((r) => ({
      uuid: r.uuid,
      coordinatorUuid: r.coordinatorUuid,
      name: r.name,
      volume: r.volume,
      muted: r.muted,
    })),
    dataUpdatedAt,
  );

  if (!data) {
    return (
      <SoundSystemTileView
        status={isError ? "error" : "loading"}
        rooms={[]}
        vols={{}}
        mutes={{}}
        globalLock={false}
        groupLock={false}
        onFaderChange={() => {}}
        onToggleGlobalLock={() => {}}
        onToggleGroupLock={() => {}}
        onOpenMixer={() => {}}
        onOpenSource={() => {}}
        onOpenGroups={() => {}}
      />
    );
  }

  function handleFaderChange(uuid: string, value: number) {
    // Local fader is instant , useMixer updates immediately per move.
    mixer.setRoomVolume(uuid, value);
    const room = rooms.find((r) => r.uuid === uuid);
    if (!room) return;
    // Network write is throttled (~200ms leading + trailing) so a drag sends
    // at most ~1 UPnP command per 200ms; the trailing edge always delivers the
    // final value (covers pointer-up). Dedupe skips writes for unchanged values.
    writeVolume(room.deviceIp, Math.round(value));
  }

  return (
    <>
      <SoundSystemTileView
        status="populated"
        rooms={rooms}
        vols={mixer.vols}
        mutes={mixer.mutes}
        globalLock={mixer.globalLock}
        groupLock={mixer.groupLock}
        onFaderChange={handleFaderChange}
        onToggleGlobalLock={() => mixer.setGlobalLock(!mixer.globalLock)}
        onToggleGroupLock={mixer.toggleGroupLock}
        onOpenMixer={() => setMixerOpen(true)}
        onOpenSource={() => setSourceOpen(true)}
        onOpenGroups={() => setGroupsOpen(true)}
      />

      <GroupsModal
        open={groupsOpen}
        onClose={() => setGroupsOpen(false)}
        rooms={rooms}
        dataUpdatedAt={dataUpdatedAt}
      />

      <MixerModal
        open={mixerOpen}
        onClose={() => setMixerOpen(false)}
        rooms={rooms}
        mixer={mixer}
        onSetVolume={(uuid, value) => {
          // Local fader instant; network write throttled via writeVolume.
          mixer.setRoomVolume(uuid, value);
          const room = rooms.find((r) => r.uuid === uuid);
          if (room) writeVolume(room.deviceIp, Math.round(value));
        }}
        onSetMute={(uuid, muted) => {
          mixer.toggleMute(uuid);
          const room = rooms.find((r) => r.uuid === uuid);
          if (room) setMuteMutation.mutate({ deviceIp: room.deviceIp, muted });
        }}
        onGroupJoin={(memberIp, coordinatorUuid) =>
          groupJoinMutation.mutate({ memberIp, coordinatorUuid })
        }
        onGroupLeave={(memberIp, memberUuid) => groupLeaveMutation.mutate({ memberIp, memberUuid })}
      />

      <SourceModal
        open={sourceOpen}
        onClose={() => setSourceOpen(false)}
        rooms={rooms}
        onSetSource={(uuid, source) => {
          // Only Line-in has a backend write today; a player's own UUID is its
          // line-in stream source (x-rincon-stream:<uuid>:0). Other sources have
          // no mutation yet , never actuate with fake data.
          const room = rooms.find((r) => r.uuid === uuid);
          if (room && source === "Line-in") {
            setLineInMutation.mutate({ deviceIp: room.deviceIp, sourceUuid: room.uuid });
          }
        }}
      />
    </>
  );
}
