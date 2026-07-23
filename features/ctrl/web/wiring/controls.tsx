/**
 * Controls tile , live wiring for its single detail-page variant (the expanded
 * lamps/lights/fan surface with scenes, brightness, and party mode).
 *
 * Data + mutations come from useControls (exported by ControlsTile), the exact
 * wiring the tile face uses , same trpc.controls.list query key, so react-query
 * dedupes the fetch while the page is open.
 */

import type { DetailVariant, TileDetailPageEntry } from "@/components/tiles/detail/types";
import { TileStatus } from "@/components/ui";
import { useControls } from "../ControlsTile";
import { ExpandedControlsView } from "../ExpandedControlsView";

function useControlsVariants(): { variants: DetailVariant[]; loading: boolean } {
  const controls = useControls();

  if (controls.status !== TileStatus.Populated) return { variants: [], loading: true };

  const variants: DetailVariant[] = [
    {
      slug: "detail",
      label: "Controls",
      render: () => (
        <ExpandedControlsView
          data={controls.viewData}
          onToggle={controls.onToggle}
          onScene={controls.onScene}
          onBrightness={controls.onBrightness}
          speed={controls.speed}
          onPartySelect={controls.onPartySelect}
        />
      ),
    },
  ];

  return { variants, loading: false };
}

export const controlsDetailEntry: TileDetailPageEntry = {
  kind: "page",
  tileId: "tile_ctrl",
  title: "Controls",
  defaultSlug: "detail",
  useVariants: useControlsVariants,
};
