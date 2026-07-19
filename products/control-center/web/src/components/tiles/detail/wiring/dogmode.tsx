/**
 * Dog Mode tile , live wiring for its single detail-page variant.
 *
 * Dog Mode is an honest placeholder: the routine is not connected to the house
 * yet, so the page shows exactly what the tile face shows , the routine
 * preview list, the shared preview arm flag (dogmode-preview-store, so the
 * face and page never disagree), and the "not yet connected" copy. NO live
 * status is fabricated; when the routine is wired up this page gains real
 * state the same way every other detail page did.
 */

import { DogModeTileView } from "@/components/tiles/DogModeTileView";
import { toggleDogModePreview, useDogModePreview } from "@/lib/dogmode-preview-store";
import type { DetailVariant, TileDetailPageEntry } from "../types";

function DogModePage() {
  const armed = useDogModePreview();
  return (
    // The page reuses the tile card at reading width , same content, no
    // invented extras. Fixed height so the card's internal flex layout holds.
    <div style={{ maxWidth: 560, height: 420, margin: "0 auto" }}>
      <DogModeTileView armed={armed} onToggle={toggleDogModePreview} />
    </div>
  );
}

function useDogModeVariants(): { variants: DetailVariant[]; loading: boolean } {
  const variants: DetailVariant[] = [
    {
      slug: "dogmode",
      label: "Dog Mode",
      render: () => <DogModePage />,
    },
  ];
  return { variants, loading: false };
}

export const dogModeDetailEntry: TileDetailPageEntry = {
  kind: "page",
  tileId: "tile_dogmode",
  title: "Dog Mode",
  defaultSlug: "dogmode",
  useVariants: useDogModeVariants,
};
