/**
 * Quick Play tile , live wiring for its two detail-page variants: "Favorites"
 * (Sonos favorites cover grid) and "Spotify" (browse rows).
 *
 * Data: trpc.sound.sonosFavorites + spotify.browse + soundSystem (for the zone
 * chips), polled here while the page is open with the same query keys as the
 * tile face, so react-query dedupes the fetches. Playing still routes through
 * sonosTransport on the first room coordinator , a dedicated sonosPlayUri
 * mutation is follow-up backend work (mirrors the tile's old modal wiring).
 */

import type { DetailVariant, TileDetailPageEntry } from "@/components/tiles/detail/types";
import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import { FavoritesModal } from "../FavoritesModal";
import { SpotifyModal } from "../SpotifyModal";

function useQuickPlayVariants(): { variants: DetailVariant[]; loading: boolean } {
  const { data: favData } = trpc.sound.sonosFavorites.useQuery(undefined, {
    refetchInterval: POLL.quickPlay,
  });
  const { data: spotifyData } = trpc.sound.spotify.browse.useQuery(undefined, {
    refetchInterval: POLL.quickPlay,
  });
  const { data: soundData } = trpc.sound.soundSystem.useQuery(undefined, {
    refetchInterval: POLL.quickPlay,
  });

  const sonosTransportMutation = trpc.sound.sonosTransport.useMutation();

  // Ready as soon as either content source resolves , the same gate the tile
  // face uses for its merged rail.
  if (favData === undefined && spotifyData === undefined) {
    return { variants: [], loading: true };
  }

  const zones = (soundData?.rooms ?? []).map((r) => r.name);

  // Playing a favorite/track requires a SetAVTransportURI call which maps to
  // sonosTransport play after setting the URI. For now trigger play on the
  // first room coordinator , a full implementation requires a dedicated
  // sonosPlayUri mutation (follow-up work).
  function playOnFirstRoom() {
    const firstRoom = soundData?.rooms[0];
    if (firstRoom) {
      sonosTransportMutation.mutate({
        coordinatorIp: firstRoom.coordinatorUuid,
        command: "play",
      });
    }
  }

  const variants: DetailVariant[] = [
    {
      slug: "favorites",
      label: "Favorites",
      render: () => (
        <FavoritesModal
          favorites={favData ?? []}
          zones={zones}
          onPlay={(_fav, _zone) => playOnFirstRoom()}
        />
      ),
    },
    {
      slug: "spotify",
      label: "Spotify",
      render: () => (
        <SpotifyModal
          recentlyPlayed={(spotifyData?.recentlyPlayed ?? []).map((t) => ({
            ...t,
            albumArtUrl: t.albumArtUrl ?? null,
          }))}
          playlists={(spotifyData?.playlists ?? []).map((p) => ({
            ...p,
            albumArtUrl: p.imageUrl ?? null,
          }))}
          zones={zones}
          onPlay={(_uri, _zone) => playOnFirstRoom()}
        />
      ),
    },
  ];

  return { variants, loading: false };
}

export const quickPlayDetailEntry: TileDetailPageEntry = {
  kind: "page",
  tileId: "tile_quickplay",
  title: "Quick Play",
  defaultSlug: "favorites",
  useVariants: useQuickPlayVariants,
};
