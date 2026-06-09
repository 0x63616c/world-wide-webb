/**
 * QuickPlayTile — container for the Quick-Play 4×2 tile (www-51hf.23 / A28).
 *
 * Fetches Sonos Favorites + Spotify browse content. Merges them into a unified
 * rail of QuickPlayItems. Opens FavoritesModal and SpotifyModal on button taps.
 * Renders Skeleton while pending/error (A18).
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { FavoritesModal } from "./FavoritesModal";
import type { QuickPlayItem } from "./QuickPlayTileView";
import { QuickPlayTileView } from "./QuickPlayTileView";
import { SpotifyModal } from "./SpotifyModal";

const QP_POLL_MS = 30_000;

export function QuickPlayTile() {
  const { data: favData, isError: favError } = trpc.media.sonosFavorites.useQuery(undefined, {
    refetchInterval: QP_POLL_MS,
  });
  const { data: spotifyData, isError: spotifyError } = trpc.media.spotify.browse.useQuery(
    undefined,
    { refetchInterval: QP_POLL_MS },
  );
  const { data: soundData } = trpc.media.soundSystem.useQuery(undefined, {
    refetchInterval: QP_POLL_MS,
  });

  const [favOpen, setFavOpen] = useState(false);
  const [spotifyOpen, setSpotifyOpen] = useState(false);

  const sonosTransportMutation = trpc.media.sonosTransport.useMutation();

  const isLoading = !favData && !favError && !spotifyData && !spotifyError;

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

  if (isLoading) {
    return (
      <QuickPlayTileView
        status="loading"
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
        status="populated"
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
          // the first room coordinator — a full implementation requires a
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
          // Queuing as follow-up — trigger play for now on the coordinator.
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
