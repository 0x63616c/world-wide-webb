/**
 * SoundSystemTile — container for the Sound System 4×3 tile (www-51hf.18 / A22).
 *
 * Resolves media.soundSystem via tRPC with a 10s poll (topology + volume changes
 * are infrequent). Renders Skeleton while pending/error (A18). On success passes
 * all rooms to useMixer for local gang-lock state, then renders SoundSystemTileView.
 *
 * Opens MixerModal on expand. Opens SourceModal when a room name is tapped
 * (A25/A31) — selecting Line-in writes the room's source via sonosSetLineIn.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useMixer } from "./hooks/useMixer";
import { MixerModal } from "./MixerModal";
import { SoundSystemTileView } from "./SoundSystemTileView";
import { SourceModal } from "./SourceModal";

const SOUND_POLL_MS = 10_000;

export function SoundSystemTile() {
  const { data, isError } = trpc.media.soundSystem.useQuery(undefined, {
    refetchInterval: SOUND_POLL_MS,
  });

  const [mixerOpen, setMixerOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);

  const setVolMutation = trpc.media.sonosSetVolume.useMutation();
  const setMuteMutation = trpc.media.sonosSetMute.useMutation();
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
  );

  if (!data) {
    return (
      <SoundSystemTileView
        status={isError ? "error" : "loading"}
        rooms={[]}
        vols={{}}
        mutes={{}}
        globalLock={false}
        onFaderChange={() => {}}
        onToggleGlobalLock={() => {}}
        onOpenMixer={() => {}}
        onOpenSource={() => {}}
      />
    );
  }

  function handleFaderChange(uuid: string, value: number) {
    mixer.setRoomVolume(uuid, value);
    const room = rooms.find((r) => r.uuid === uuid);
    if (!room) return;
    // Write to the room's real device IP (each player owns its own volume).
    setVolMutation.mutate({ deviceIp: room.deviceIp, volume: Math.round(value) });
  }

  return (
    <>
      <SoundSystemTileView
        status="populated"
        rooms={rooms}
        vols={mixer.vols}
        mutes={mixer.mutes}
        globalLock={mixer.globalLock}
        onFaderChange={handleFaderChange}
        onToggleGlobalLock={() => mixer.setGlobalLock(!mixer.globalLock)}
        onOpenMixer={() => setMixerOpen(true)}
        onOpenSource={() => setSourceOpen(true)}
      />

      <MixerModal
        open={mixerOpen}
        onClose={() => setMixerOpen(false)}
        rooms={rooms}
        mixer={mixer}
        onSetVolume={(uuid, value) => {
          mixer.setRoomVolume(uuid, value);
          const room = rooms.find((r) => r.uuid === uuid);
          if (room) setVolMutation.mutate({ deviceIp: room.deviceIp, volume: Math.round(value) });
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
          // no mutation yet — never actuate with fake data.
          const room = rooms.find((r) => r.uuid === uuid);
          if (room && source === "Line-in") {
            setLineInMutation.mutate({ deviceIp: room.deviceIp, sourceUuid: room.uuid });
          }
        }}
      />
    </>
  );
}
