import { useEffect, useRef, useState } from "react";
import { trpc } from "../../lib/trpc";
import { DogCamTileView } from "./DogCamTileView";

export function DogCamTile() {
  const [live, setLive] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data, isLoading } = trpc.camera.info.useQuery(undefined, {
    refetchInterval: 30_000,
    retry: 2,
  });

  // Drive the REC timer from the live flag — interval lives here, not in the view
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
      status={isLoading || !data ? "loading" : "populated"}
      label={data?.label ?? null}
      online={data?.online ?? false}
      snapshotUrl={data?.snapshotUrl ?? null}
      live={live}
      recSecs={recSecs}
      onToggleLive={() => setLive((v) => !v)}
    />
  );
}
