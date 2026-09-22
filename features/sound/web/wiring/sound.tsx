/**
 * Sound System tile , live wiring for its single detail-page variant (the
 * full-page Sound System view: volumes, calibration, grouping).
 *
 * Data: useSoundControls, the same hook behind the tile face (same query key,
 * so react-query dedupes the fetch while the page is open).
 */

import type { DetailVariant, TileDetailPageEntry } from "@/components/tiles/detail/types";
import { trpc } from "@/lib/trpc";
import { useSoundControls } from "../hooks/useSoundControls";
import { SoundSystemPage } from "../SoundSystemPage";

function LiveSoundSystemPage() {
  const controls = useSoundControls();
  const diagnostics = trpc.sound.soundSystem.useQuery(undefined).data?.diagnostics ?? null;
  return <SoundSystemPage controls={controls} diagnostics={diagnostics} />;
}

function useSoundVariants(): { variants: DetailVariant[]; loading: boolean } {
  const query = trpc.sound.soundSystem.useQuery(undefined);
  if (!query.data && !query.isError) return { variants: [], loading: true };
  const variants: DetailVariant[] = [
    {
      slug: "detail",
      label: "Sound System",
      render: () => <LiveSoundSystemPage />,
    },
  ];
  return { variants, loading: false };
}

export const soundDetailEntry: TileDetailPageEntry = {
  kind: "page",
  tileId: "tile_sound",
  title: "Sound System",
  defaultSlug: "detail",
  useVariants: useSoundVariants,
};
