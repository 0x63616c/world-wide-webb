import { POLL } from "@/lib/hooks";
import { openTileDetail } from "@/lib/tile-detail-store";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import { DogCamTileView } from "./DogCamTileView";

/**
 * Thin container for the Living Room Cam tile face. The face stays covered
 * (frosted snapshot poster) , tapping the feed opens the full-page detail via
 * the tile-detail registry (detail/wiring/dogcam.tsx), which owns the live/REC
 * toggle the face used to run inline.
 */
export function DogCamTile() {
  const { status, data } = useTileQuery(
    trpc.camera.info.useQuery(undefined, {
      refetchInterval: POLL.dogcam,
      retry: 2,
    }),
  );

  return (
    <DogCamTileView
      status={status}
      label={data?.label ?? null}
      online={data?.online ?? false}
      snapshotUrl={data?.snapshotUrl ?? null}
      streamUrl={data?.streamUrl ?? null}
      live={false}
      recSecs={0}
      onToggleLive={() => openTileDetail("tile_dogcam")}
    />
  );
}
