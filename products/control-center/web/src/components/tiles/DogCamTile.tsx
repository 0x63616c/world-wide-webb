import { useEffect, useRef, useState } from "react";
import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import { DogCamTileView } from "./DogCamTileView";

export function DogCamTile() {
  const [live, setLive] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { status, data } = useTileQuery(
    trpc.camera.info.useQuery(undefined, {
      refetchInterval: POLL.dogcam,
      retry: 2,
    }),
  );

  // Drive the REC timer from the live flag , interval lives here, not in the view
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
  );
}
