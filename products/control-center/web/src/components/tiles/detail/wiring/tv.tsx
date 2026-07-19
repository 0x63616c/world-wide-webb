/**
 * TV tile , live wiring for its two detail-page variants: "Now Playing"
 * (TransportScrubModal , artwork + scrubber + transport) and "Remote"
 * (TvRemoteModal , D-pad + playback keys).
 *
 * Data: trpc.media.tvNowPlaying, polled here while the page is open (same
 * query key as the tile face, so react-query dedupes the fetch). Transport,
 * seek, and remote mutations mirror the tile's wiring; useLivePosition ticks
 * the displayed position forward between polls exactly as the tile face does.
 */

import { useLivePosition } from "@/components/media/hooks/useLivePosition";
import { TransportScrubModal } from "@/components/media/TransportScrubModal";
import { TvRemoteModal } from "@/components/media/TvRemoteModal";
import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import type { DetailVariant, TileDetailPageEntry } from "../types";

function useTvVariants(): { variants: DetailVariant[]; loading: boolean } {
  const query = trpc.media.tvNowPlaying.useQuery(undefined, {
    refetchInterval: POLL.tvNowPlaying,
  });
  const data = query.data;

  const playMutation = trpc.media.tvPlay.useMutation();
  const pauseMutation = trpc.media.tvPause.useMutation();
  const nextMutation = trpc.media.tvNext.useMutation();
  const prevMutation = trpc.media.tvPrevious.useMutation();
  const seekMutation = trpc.media.tvSeek.useMutation();
  const remoteMutation = trpc.media.tvRemote.useMutation();

  // HA's media_position is only refreshed on state changes , tick it forward
  // locally while playing so the time/scrubber don't freeze between polls.
  const livePosition = useLivePosition(
    data?.mediaPosition ?? null,
    data?.mediaPositionUpdatedAt ?? null,
    data?.state ?? "idle",
    data?.mediaDuration ?? null,
  );

  if (!data) return { variants: [], loading: true };

  function handlePlayPause() {
    if (!data) return;
    if (data.state === "playing") {
      pauseMutation.mutate();
    } else {
      playMutation.mutate();
    }
  }

  const variants: DetailVariant[] = [
    {
      slug: "transport",
      label: "Now Playing",
      render: () => (
        <TransportScrubModal
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
          onSeek={(positionSeconds) =>
            seekMutation.mutate({ seekPositionSeconds: positionSeconds })
          }
        />
      ),
    },
    {
      slug: "remote",
      label: "Remote",
      render: () => (
        <TvRemoteModal
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
      ),
    },
  ];

  return { variants, loading: false };
}

export const tvDetailEntry: TileDetailPageEntry = {
  kind: "page",
  tileId: "tile_tv",
  title: "TV",
  defaultSlug: "transport",
  useVariants: useTvVariants,
};
