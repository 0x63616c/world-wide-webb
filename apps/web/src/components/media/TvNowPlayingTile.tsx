/**
 * TvNowPlayingTile — container for the TV Now Playing 4×3 tile (CC-51hf.15).
 *
 * Resolves media.tvNowPlaying via tRPC, renders a Skeleton shimmer while
 * pending/error (A18). On success hands all data to TvNowPlayingTileView;
 * transport mutations (prev/play-pause/next/seek) wired to tRPC mutations.
 */

import { trpc } from "@/lib/trpc";
import { TvNowPlayingTileView } from "./TvNowPlayingTileView";

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
    />
  );
}
