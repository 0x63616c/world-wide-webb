import { useState } from "react";
import { TileStatus } from "@/components/ui";
import { trpc } from "@/lib/trpc";
import { WakePhotoViewer } from "./WakePhotoViewer";
import { WakesTileView } from "./WakesTileView";

/** Matches the api's UTC day buckets (wake-photo-service dayDirFor). */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function WakesTile() {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const listing = trpc.wakePhotos.list.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const sessions = trpc.sessions.list.useQuery(undefined, {
    refetchInterval: 60_000,
    enabled: viewerOpen,
  });
  const sessionDetail = trpc.sessions.get.useQuery(
    { id: selectedSessionId ?? "" },
    { enabled: selectedSessionId !== null },
  );

  const status = listing.isError
    ? TileStatus.Error
    : listing.data
      ? TileStatus.Populated
      : TileStatus.Loading;

  const today = listing.data?.days.find((d) => d.day === utcToday());
  const latest = listing.data?.days[0]?.photos[0];

  return (
    <>
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
        onOpen={() => setViewerOpen(true)}
      />
      <WakePhotoViewer
        open={viewerOpen}
        onClose={() => {
          setViewerOpen(false);
          // Reopening starts at the list, not a stale detail.
          setSelectedSessionId(null);
        }}
        days={listing.data?.days ?? []}
        totalCount={listing.data?.totalCount ?? 0}
        totalBytes={listing.data?.totalBytes ?? 0}
        photoUrl={(path) => `/media/wake-photos/${path}`}
        sessions={sessions.data ?? []}
        // Only hand over a detail that matches the CURRENT selection , while a
        // newly-selected session's query is in flight, react-query still holds
        // the previous session's data, which would render the wrong transcript
        // under the new row's identity.
        selectedSession={
          sessionDetail.data && sessionDetail.data.id === selectedSessionId
            ? sessionDetail.data
            : null
        }
        onSelectSession={setSelectedSessionId}
      />
    </>
  );
}
