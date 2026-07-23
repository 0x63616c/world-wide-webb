/**
 * Living Room Cam tile , live wiring for its single detail-page variant.
 *
 * The page reuses DogCamTileView , the exact feed surface the tile face renders
 * , at page scale, with the live/REC toggle state owned here (the face used to
 * own it; now the face just opens this page). Data: trpc.camera.info, same
 * query key as the tile face, so react-query dedupes the fetch while the page
 * is open. No new features , the same snapshot poster, MJPEG live toggle, and
 * REC timer the tile always had, just bigger.
 */

import { DogCamTileView } from "@features/dogcam/web";
import { useEffect, useRef, useState } from "react";
import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import type { DetailVariant, TileDetailPageEntry } from "../types";

function DogCamPage() {
  const [live, setLive] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { status, data } = useTileQuery(
    trpc.camera.info.useQuery(undefined, {
      refetchInterval: POLL.dogcam,
      retry: 2,
    }),
  );

  // Drive the REC timer from the live flag , same interval the tile face used
  // to own before the toggle moved to this page.
  useEffect(() => {
    if (live) {
      setRecSecs(0);
      timerRef.current = setInterval(() => {
        setRecSecs((s) => s + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setRecSecs(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [live]);

  return (
    // The feed card needs a definite height for its internal flex layout ,
    // fill the host's content region and center at reading width.
    <div style={{ height: "100%", minHeight: 480, maxWidth: 920, margin: "0 auto" }}>
      <DogCamTileView
        status={status}
        label={data?.label ?? null}
        online={data?.online ?? false}
        snapshotUrl={data?.snapshotUrl ?? null}
        streamUrl={data?.streamUrl ?? null}
        live={live}
        recSecs={recSecs}
        onToggleLive={() => setLive((v) => !v)}
      />
    </div>
  );
}

function useDogCamVariants(): { variants: DetailVariant[]; loading: boolean } {
  const variants: DetailVariant[] = [
    {
      slug: "dogcam",
      label: "Living Room Cam",
      render: () => <DogCamPage />,
    },
  ];
  return { variants, loading: false };
}

export const dogCamDetailEntry: TileDetailPageEntry = {
  kind: "page",
  tileId: "tile_dogcam",
  title: "Living Room Cam",
  defaultSlug: "dogcam",
  useVariants: useDogCamVariants,
};
