import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import { WakesTileView } from "./WakesTileView";

/** Matches the api's UTC day buckets (wake-photo-service dayDirFor). */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Thin container for the Activity tile face , today's wake count + last wake
 * time. Tapping the tile opens the full-page viewer via the board's tile-detail
 * registry (detail/wiring/activity.tsx), whose host runs the PIN gate before
 * the photos mount , the gate this container used to hand-wire itself.
 */
export function WakesTile() {
  const listing = trpc.wakePhotos.list.useQuery(undefined, {
    refetchInterval: POLL.wakePhotos,
  });

  const { status } = useTileQuery(listing);

  const today = listing.data?.days.find((d) => d.day === utcToday());
  const latest = listing.data?.days[0]?.photos[0];

  return (
    <WakesTileView
      status={status}
      todayCount={today?.photos.length ?? 0}
      lastWakeLabel={
        latest
          ? new Date(latest.capturedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
          : null
      }
    />
  );
}
