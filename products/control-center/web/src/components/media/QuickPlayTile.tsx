/**
 * QuickPlayTile , container for the Quick-Play 4×2 tile (www-51hf.23 / A28).
 *
 * Fetches Sonos Favorites + Spotify browse content. Merges them into a unified
 * rail of QuickPlayItems. Opens FavoritesModal and SpotifyModal on button taps.
 * Renders Skeleton while pending/error (A18).
 */

import { useState } from "react";
import { TileStatus } from "@/components/ui";
import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import { FavoritesModal } from "./FavoritesModal";
import type { QuickPlayItem } from "./QuickPlayTileView";
import { QuickPlayTileView } from "./QuickPlayTileView";
import { SpotifyModal } from "./SpotifyModal";

export function QuickPlayTile() {
  const { data: favData, isError: favError } = trpc.media.sonosFavorites.useQuery(undefined, {
    refetchInterval: POLL.quickPlay,
  });
  const { data: spotifyData, isError: spotifyError } = trpc.media.spotify.browse.useQuery(
    undefined,
    { refetchInterval: POLL.quickPlay },
  );
  const { data: soundData } = trpc.media.soundSystem.useQuery(undefined, {
    refetchInterval: POLL.quickPlay,
  });

  const [favOpen, setFavOpen] = useState(false);
  const [spotifyOpen, setSpotifyOpen] = useState(false);

  const sonosTransportMutation = trpc.media.sonosTransport.useMutation();

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

  const zones = (soundData?.rooms ?? []).map((r) => r.name);

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
    <>
      <QuickPlayTileView
        status={q.status}
        items={items}
        playingItemId={null}
        onPlayItem={() => {}}
        onOpenFavorites={() => setFavOpen(true)}
        onOpenSpotify={() => setSpotifyOpen(true)}
      />

      <FavoritesModal
        open={favOpen}
        onClose={() => setFavOpen(false)}
        favorites={favData ?? []}
        zones={zones}
        onPlay={(_fav, _zone) => {
          // Playing a favorite requires a SetAVTransportURI call which maps to
          // sonosTransport play after setting the URI. For now trigger play on
          // the first room coordinator , a full implementation requires a
          // dedicated sonosPlayUri mutation (follow-up work).
          const firstRoom = soundData?.rooms[0];
          if (firstRoom) {
            sonosTransportMutation.mutate({
              coordinatorIp: firstRoom.coordinatorUuid,
              command: "play",
            });
          }
        }}
      />

      <SpotifyModal
        open={spotifyOpen}
        onClose={() => setSpotifyOpen(false)}
        recentlyPlayed={(spotifyData?.recentlyPlayed ?? []).map((t) => ({
          ...t,
          albumArtUrl: t.albumArtUrl ?? null,
        }))}
        playlists={(spotifyData?.playlists ?? []).map((p) => ({
          ...p,
          albumArtUrl: p.imageUrl ?? null,
        }))}
        zones={zones}
        onPlay={(_uri, _zone) => {
          // Spotify playback to Sonos requires a SetAVTransportURI with the Spotify URI.
          // Queuing as follow-up , trigger play for now on the coordinator.
          const firstRoom = soundData?.rooms[0];
          if (firstRoom) {
            sonosTransportMutation.mutate({
              coordinatorIp: firstRoom.coordinatorUuid,
              command: "play",
            });
          }
        }}
      />
    </>
  );
}
