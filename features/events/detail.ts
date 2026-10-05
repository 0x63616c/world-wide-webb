import { defineTileViews } from "@app-kit";
import { createElement } from "react";
import type { TileDetailPageEntry } from "@/components/tiles/detail/types";
import { AlarmsPage } from "./web/AlarmsPage";

export const tileViews = defineTileViews<TileDetailPageEntry>([
  {
    kind: "page",
    tileId: "tile_clock",
    title: "Alarms",
    defaultSlug: "alarms",
    useVariants: () => ({
      variants: [{ slug: "alarms", label: "Alarms", render: () => createElement(AlarmsPage) }],
      loading: false,
    }),
  },
]);
