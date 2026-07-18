/**
 * TvNowPlayingTile , container for the TV Now Playing 4×3 tile (www-51hf.15).
 *
 * Resolves media.tvNowPlaying via tRPC, renders a Skeleton shimmer while
 * pending/error (A18). On success hands all data to TvNowPlayingTileView;
 * transport mutations (prev/play-pause/next/seek) wired to tRPC mutations.
 * Wires TransportScrubModal (A20) and TvRemoteModal (A21) , ownsTap:true
 * means the tile is responsible for opening its own modals (www-51hf.53).
 */

import { useState } from "react";
import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import { useLivePosition } from "./hooks/useLivePosition";
import { TransportScrubModal } from "./TransportScrubModal";
import { TvNowPlayingTileView } from "./TvNowPlayingTileView";
import { TvRemoteModal } from "./TvRemoteModal";

export function TvNowPlayingTile() {
  const q = useTileQuery(
    trpc.media.tvNowPlaying.useQuery(undefined, {
      refetchInterval: POLL.tvNowPlaying,
    }),
  );
  const data = q.data;

  const playMutation = trpc.media.tvPlay.useMutation();
  const pauseMutation = trpc.media.tvPause.useMutation();
  const nextMutation = trpc.media.tvNext.useMutation();
  const prevMutation = trpc.media.tvPrevious.useMutation();
  const seekMutation = trpc.media.tvSeek.useMutation();
  const remoteMutation = trpc.media.tvRemote.useMutation();

  const [transportOpen, setTransportOpen] = useState(false);
  const [remoteOpen, setRemoteOpen] = useState(false);

  // HA's media_position is only refreshed on state changes , tick it forward
  // locally while playing so the time/scrubber don't freeze between polls.
  const livePosition = useLivePosition(
    data?.mediaPosition ?? null,
    data?.mediaPositionUpdatedAt ?? null,
    data?.state ?? "idle",
    data?.mediaDuration ?? null,
  );

  if (!data) {
    return <TvNowPlayingTileView status={q.status} />;
  }

  function handlePlayPause() {
    if (!data) return;
    if (data.state === "playing") {
      pauseMutation.mutate();
    } else {
      playMutation.mutate();
    }
  }

  return (
    <>
      <TvNowPlayingTileView
        status={q.status}
        state={data.state}
        appName={data.appName}
        mediaTitle={data.mediaTitle}
        mediaArtist={data.mediaArtist}
        mediaPosition={livePosition}
        mediaDuration={data.mediaDuration}
        source={data.source}
        artworkUrl={data.artworkUrl}
        onPrev={() => prevMutation.mutate()}
        onPlayPause={handlePlayPause}
        onNext={() => nextMutation.mutate()}
        onSeek={(positionSeconds) => seekMutation.mutate({ seekPositionSeconds: positionSeconds })}
        onOpenTransport={() => setTransportOpen(true)}
        onOpenRemote={() => setRemoteOpen(true)}
      />

      <TransportScrubModal
        open={transportOpen}
        onClose={() => setTransportOpen(false)}
        state={data.state}
        appName={data.appName}
        mediaTitle={data.mediaTitle}
        mediaArtist={data.mediaArtist}
        mediaPosition={livePosition}
        mediaDuration={data.mediaDuration}
        source={data.source}
        artworkUrl={data.artworkUrl}
        onPrev={() => prevMutation.mutate()}
        onPlayPause={handlePlayPause}
        onNext={() => nextMutation.mutate()}
        onSeek={(positionSeconds) => seekMutation.mutate({ seekPositionSeconds: positionSeconds })}
      />

      <TvRemoteModal
        open={remoteOpen}
        onClose={() => setRemoteOpen(false)}
        state={data.state}
        appName={data.appName}
        mediaTitle={data.mediaTitle}
        mediaArtist={data.mediaArtist}
        artworkUrl={data.artworkUrl}
        onUp={() => remoteMutation.mutate({ command: "up" })}
        onDown={() => remoteMutation.mutate({ command: "down" })}
        onLeft={() => remoteMutation.mutate({ command: "left" })}
        onRight={() => remoteMutation.mutate({ command: "right" })}
        onOk={() => remoteMutation.mutate({ command: "select" })}
        onMenu={() => remoteMutation.mutate({ command: "menu" })}
        onHome={() => remoteMutation.mutate({ command: "home" })}
        onPower={() => remoteMutation.mutate({ command: "power" })}
        onPlayPause={handlePlayPause}
        onPrev={() => prevMutation.mutate()}
        onNext={() => nextMutation.mutate()}
      />
    </>
  );
}
