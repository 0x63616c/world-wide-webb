/**
 * SoundSystemTile — container for the Sound System 4×3 tile (CC-51hf.18 / A22).
 *
 * Resolves media.soundSystem via tRPC with a 10s poll (topology + volume changes
 * are infrequent). Renders Skeleton while pending/error (A18). On success passes
 * all rooms to useMixer for local gang-lock state, then renders SoundSystemTileView.
 *
 * Opens MixerModal on expand. Opens SourceModal on room card tap (wired later).
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

  const rooms = data?.rooms ?? [];

  const mixer = useMixer(
    rooms.map((r) => ({
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
      />
    );
  }

  function handleFaderChange(uuid: string, value: number) {
    mixer.setRoomVolume(uuid, value);
    // Find deviceIp from the room data.
    const room = rooms.find((r) => r.coordinatorUuid === uuid);
    if (!room) return;
    // SoundSystemRoom doesn't expose deviceIp — we derive it from coordinatorUuid
    // by passing coordinatorUuid as deviceIp. The Sonos write service uses IP, but
    // the tRPC input expects deviceIp. For now we pass coordinatorUuid as a placeholder
    // until the service exposes coordinatorIp. The mutation will fail gracefully.
    setVolMutation.mutate({ deviceIp: uuid, volume: Math.round(value) });
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
      />

      <MixerModal
        open={mixerOpen}
        onClose={() => setMixerOpen(false)}
        rooms={rooms}
        mixer={mixer}
        onSetVolume={(uuid, value) => {
          mixer.setRoomVolume(uuid, value);
          setVolMutation.mutate({ deviceIp: uuid, volume: Math.round(value) });
        }}
        onSetMute={(uuid, muted) => {
          mixer.toggleMute(uuid);
          const room = rooms.find((r) => r.coordinatorUuid === uuid);
          if (room) setMuteMutation.mutate({ deviceIp: uuid, muted });
        }}
        onGroupJoin={(memberIp, coordinatorUuid) =>
          groupJoinMutation.mutate({ memberIp, coordinatorUuid })
        }
        onGroupLeave={(memberIp, memberUuid) => groupLeaveMutation.mutate({ memberIp, memberUuid })}
      />

      <SourceModal open={sourceOpen} onClose={() => setSourceOpen(false)} rooms={rooms} />
    </>
  );
}
