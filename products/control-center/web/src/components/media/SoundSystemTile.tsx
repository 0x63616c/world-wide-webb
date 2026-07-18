/**
 * SoundSystemTile , container for the Sound System 4×3 tile (www-51hf.18 / A22).
 *
 * Resolves media.soundSystem via tRPC with a 10s poll (topology + volume changes
 * are infrequent). Renders Skeleton while pending/error (A18). On success passes
 * all rooms to useMixer for local gang-lock state, then renders SoundSystemTileView.
 *
 * Tapping the tile opens the GroupsModal (patch-bay source/speaker routing). The
 * old MixerModal and per-room SourceModal were removed , the Groups modal is the
 * one control surface that matters (www-tvoff).
 */

import { useCallback, useState } from "react";
import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import { GroupsModal } from "./GroupsModal";
import { useMixer } from "./hooks/useMixer";
import { useThrottledVolume } from "./hooks/useThrottledVolume";
import { SoundSystemTileView } from "./SoundSystemTileView";

export function SoundSystemTile() {
  // dataUpdatedAt gates useMixer's reconcile: only a snapshot fetched after a
  // fader's last local edit may overwrite it (www-tavs stale-poll snap-back).
  const query = trpc.media.soundSystem.useQuery(undefined, {
    refetchInterval: POLL.soundSystem,
  });
  const q = useTileQuery(query);
  const { dataUpdatedAt } = query;

  const [groupsOpen, setGroupsOpen] = useState(false);

  const setVolMutation = trpc.media.sonosSetVolume.useMutation();

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

  const rooms = q.data?.rooms ?? [];

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

  if (!q.data) {
    return (
      <SoundSystemTileView
        status={q.status}
        rooms={[]}
        vols={{}}
        mutes={{}}
        globalLock={false}
        groupLock={false}
        onFaderChange={() => {}}
        onToggleGlobalLock={() => {}}
        onToggleGroupLock={() => {}}
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
        status={q.status}
        rooms={rooms}
        vols={mixer.vols}
        mutes={mixer.mutes}
        globalLock={mixer.globalLock}
        groupLock={mixer.groupLock}
        onFaderChange={handleFaderChange}
        onToggleGlobalLock={() => mixer.setGlobalLock(!mixer.globalLock)}
        onToggleGroupLock={mixer.toggleGroupLock}
        onOpenGroups={() => setGroupsOpen(true)}
      />

      <GroupsModal
        open={groupsOpen}
        onClose={() => setGroupsOpen(false)}
        rooms={rooms}
        dataUpdatedAt={dataUpdatedAt}
      />
    </>
  );
}
