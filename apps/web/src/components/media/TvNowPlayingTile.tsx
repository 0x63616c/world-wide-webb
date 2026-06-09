/**
 * TvNowPlayingTile — container for the TV Now Playing 4×3 tile (CC-51hf.15).
 *
 * Resolves media.tvNowPlaying via tRPC, renders a Skeleton shimmer while
 * pending/error (A18). On success hands all data to TvNowPlayingTileView;
 * transport mutations (prev/play-pause/next/seek) wired to tRPC mutations.
 * Wires TransportScrubModal (A20) and TvRemoteModal (A21) — ownsTap:true
 * means the tile is responsible for opening its own modals (CC-51hf.53).
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { TransportScrubModal } from "./TransportScrubModal";
import { TvNowPlayingTileView } from "./TvNowPlayingTileView";
import { TvRemoteModal } from "./TvRemoteModal";

// 5-second polling interval — Apple TV state changes quickly during playback.
const TV_POLL_MS = 5_000;

export function TvNowPlayingTile() {
  const { data, isError } = trpc.media.tvNowPlaying.useQuery(undefined, {
    refetchInterval: TV_POLL_MS,
  });

  const playMutation = trpc.media.tvPlay.useMutation();
  const pauseMutation = trpc.media.tvPause.useMutation();
  const nextMutation = trpc.media.tvNext.useMutation();
  const prevMutation = trpc.media.tvPrevious.useMutation();
  const seekMutation = trpc.media.tvSeek.useMutation();
  const remoteMutation = trpc.media.tvRemote.useMutation();

  const [transportOpen, setTransportOpen] = useState(false);
  const [remoteOpen, setRemoteOpen] = useState(false);

  if (!data) {
    return <TvNowPlayingTileView status={isError ? "error" : "loading"} />;
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
        status="populated"
        state={data.state}
        appName={data.appName}
        mediaTitle={data.mediaTitle}
        mediaArtist={data.mediaArtist}
        mediaPosition={data.mediaPosition}
        mediaDuration={data.mediaDuration}
        source={data.source}
        artworkUrl={null}
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
        mediaPosition={data.mediaPosition}
        mediaDuration={data.mediaDuration}
        source={data.source}
        artworkUrl={null}
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
        artworkUrl={null}
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
