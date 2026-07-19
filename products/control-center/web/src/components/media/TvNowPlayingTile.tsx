/**
 * TvNowPlayingTile , container for the TV Now Playing 4×3 tile (www-51hf.15).
 *
 * Resolves media.tvNowPlaying via tRPC, renders a Skeleton shimmer while
 * pending/error (A18). On success hands all data to TvNowPlayingTileView;
 * transport mutations (prev/play-pause/next/seek) wired to tRPC mutations.
 * The face's expand/remote buttons deep-link into the full-page TV detail
 * (Now Playing / Remote variants) via the tile-detail store , the page's live
 * wiring lives in tiles/detail/wiring/tv.tsx.
 */

import { POLL } from "@/lib/hooks";
import { openTileDetail } from "@/lib/tile-detail-store";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import { useLivePosition } from "./hooks/useLivePosition";
import { TvNowPlayingTileView } from "./TvNowPlayingTileView";

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
      onOpenTransport={() => openTileDetail("tile_tv", "transport")}
      onOpenRemote={() => openTileDetail("tile_tv", "remote")}
    />
  );
}
