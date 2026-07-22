/**
 * QuickPlayTile , container for the Quick-Play 4×2 tile (www-51hf.23 / A28).
 *
 * Fetches Sonos Favorites + Spotify browse content. Merges them into a unified
 * rail of QuickPlayItems. The face's Favorites/Spotify buttons deep-link into
 * the full-page Quick Play detail (Favorites / Spotify variants) via the
 * tile-detail store , the page's live wiring lives in
 * tiles/detail/wiring/quickplay.tsx. Renders Skeleton while pending/error (A18).
 */

import { TileStatus } from "@/components/ui";
import { POLL } from "@/lib/hooks";
import { openTileDetail } from "@/lib/tile-detail-store";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import type { QuickPlayItem } from "./QuickPlayTileView";
import { QuickPlayTileView } from "./QuickPlayTileView";

export function QuickPlayTile() {
  const { data: favData, isError: favError } = trpc.media.sonosFavorites.useQuery(undefined, {
    refetchInterval: POLL.quickPlay,
  });
  const { data: spotifyData, isError: spotifyError } = trpc.media.spotify.browse.useQuery(
    undefined,
    { refetchInterval: POLL.quickPlay },
  );

  // The rail merges two independent sources: it has something to show as soon as
  // either resolves, and is only in error when BOTH failed with nothing cached
  // (previously an error left it stuck rendering an empty "populated" rail).
  const q = useTileQuery({
    data: favData !== undefined || spotifyData !== undefined ? true : undefined,
    isError: favError && spotifyError,
  });

  // Build unified rail from favorites + spotify recently played.
  const items: QuickPlayItem[] = [
    ...(favData ?? []).map((f) => ({
      id: `fav:${f.uri}`,
      title: f.title,
      albumArtUri: f.albumArtUri,
      source: "sonos" as const,
      uri: f.uri,
    })),
    ...(spotifyData?.recentlyPlayed ?? []).map((t) => ({
      id: `spo:${t.id}`,
      title: t.title,
      albumArtUri: t.albumArtUrl ?? null,
      source: "spotify" as const,
      uri: t.uri,
    })),
  ];

  if (q.status !== TileStatus.Populated) {
    return (
      <QuickPlayTileView
        status={q.status}
        items={[]}
        playingItemId={null}
        onPlayItem={() => {}}
        onOpenFavorites={() => {}}
        onOpenSpotify={() => {}}
      />
    );
  }

  return (
    <QuickPlayTileView
      status={q.status}
      items={items}
      playingItemId={null}
      onPlayItem={() => {}}
      onOpenFavorites={() => openTileDetail("tile_quickplay", "favorites")}
      onOpenSpotify={() => openTileDetail("tile_quickplay", "spotify")}
    />
  );
}
