/**
 * ActivityPage , the Activity detail page (wake photos + the visits they came
 * from).
 *
 * Full-bleed: the host mounts this with `chrome: "none"` so the grid runs
 * edge-to-edge exactly like the photo booth's, which means this component owns
 * its own PageHeader and back action. The PIN gate still runs above it, in
 * GatedTileDetail, before this ever mounts.
 *
 * The grid is the shared PhotoGrid (see components/gallery/PhotoGrid) , the same
 * component the booth gallery renders, so both galleries stay identical by
 * construction. Its cells are display-only: the session transcript a photo used
 * to open died with the frontend log pipeline, so there is nothing behind a
 * frame to open and the grid does not pretend otherwise.
 *
 * The root is a flex column whose single scroll region (`flex:1; minHeight:0;
 * overflow-y:auto`) holds every mode body , the header and mode switch pin above
 * it, and no mode carries a nested scroller.
 *
 * Presentational: data arrives via props so Storybook exercises every state.
 */

import { useMemo, useState } from "react";
import { groupByDay } from "@/components/gallery/group-by-day";
import { PhotoGrid } from "@/components/gallery/PhotoGrid";
import { PageHeader, Segmented, type SegmentedOption } from "@/components/ui";
import { SessionListView, type SessionSummary } from "./SessionListView";

export interface WakePhoto {
  path: string;
  capturedAt: number;
  /** The visit this frame belongs to; null for backfilled history. */
  interactionSessionId: string | null;
}

export interface WakePhotoDay {
  /** YYYY-MM-DD (UTC buckets, straight from wakePhotos.list). */
  day: string;
  photos: WakePhoto[];
}

export interface ActivityPageProps {
  days: WakePhotoDay[];
  totalCount: number;
  totalBytes: number;
  /** Maps a listing path to a fetchable URL (the /media/wake-photos/ route). */
  photoUrl: (path: string) => string;
  /** Visits derived from the wake bursts, newest first. */
  sessions: SessionSummary[];
  /** Close the page (back to the board). */
  onBack: () => void;
}

type ViewerMode = "grid" | "sessions";

const MODE_OPTIONS: readonly SegmentedOption<ViewerMode>[] = [
  { value: "grid", label: "Grid" },
  { value: "sessions", label: "Sessions" },
];

function formatTime(capturedAt: number): string {
  return new Date(capturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

export function ActivityPage({
  days,
  totalCount,
  totalBytes,
  photoUrl,
  sessions,
  onBack,
}: ActivityPageProps) {
  const [mode, setMode] = useState<ViewerMode>("grid");

  // Regroup by LOCAL day rather than trusting the listing's UTC `day` buckets.
  // The API buckets on the UTC calendar date, so an evening capture west of
  // Greenwich (21:41 on the 19th at UTC-7 is 04:41 UTC on the 20th) landed
  // under the next day's heading while its own timestamp still read 09:41 PM.
  // Grouping off capturedAt, the same value the timestamps format from, keeps
  // the heading honest , and gives Activity the booth's Today/Yesterday labels.
  const gridDays = useMemo(
    () =>
      groupByDay(
        days.flatMap((d) => d.photos),
        (p) => p.capturedAt,
      ).map((d) => ({ key: d.key, label: d.label, count: d.items.length, items: d.items })),
    [days],
  );

  return (
    <div
      style={{
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
        color: "var(--ink)",
      }}
    >
      <PageHeader
        title="Activity"
        onBack={onBack}
        right={
          <span className="cap">
            {totalCount} photos · {formatBytes(totalBytes)}
          </span>
        }
      />

      {/* Mode switch, pinned between the header and the one scroll region. */}
      <div style={{ flexShrink: 0, padding: "0 24px 16px", display: "flex" }}>
        <div style={{ marginLeft: "auto", width: 260 }}>
          <Segmented options={MODE_OPTIONS} value={mode} onChange={setMode} label="Viewer mode" />
        </div>
      </div>

      {/* The ONE scroll region. Every mode body flows here; none carries its
          own scroller, so the header above never scrolls away. The bottom
          padding clears the home indicator (see TileDetailHost). */}
      <div
        className="modal-scroll"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          paddingBottom: "calc(40px + env(safe-area-inset-bottom, 0px))",
        }}
        data-testid="activity-scroll"
      >
        {mode === "sessions" ? (
          // Sessions render even with zero photos on disk , a browser session
          // with dimming off is still a visit worth listing.
          <div style={{ padding: "0 24px" }}>
            <SessionListView sessions={sessions} photoUrl={photoUrl} />
          </div>
        ) : (
          <PhotoGrid
            days={gridDays}
            itemKey={(p) => p.path}
            cellLabel={(p) => `Wake at ${formatTime(p.capturedAt)}`}
            renderCell={(p) => (
              <img
                src={photoUrl(p.path)}
                alt={`Wake at ${formatTime(p.capturedAt)}`}
                loading="lazy"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            )}
            renderOverlay={(p) => (
              <span
                className="mono"
                style={{
                  position: "absolute",
                  bottom: 6,
                  left: 8,
                  fontSize: 10.5,
                  color: "rgba(237,237,237,.85)",
                  textShadow: "0 1px 4px #000",
                }}
              >
                {formatTime(p.capturedAt)}
              </span>
            )}
            empty={
              <div
                className="cap"
                style={{
                  padding: "48px 24px",
                  textAlign: "center",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                No activity photos yet , they appear after the panel is next woken.
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}
