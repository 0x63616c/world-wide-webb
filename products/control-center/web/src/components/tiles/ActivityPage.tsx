/**
 * ActivityPage , the bare page body behind the Activity tile.
 *
 * Hosted by TileDetailHost (via detail/wiring/activity.tsx), which supplies the
 * page shell , portal, safe-area padding, header/BackButton, the PIN gate, and
 * the open/close lifecycle effects , so this component is layout + modes only.
 *
 * The root fills the host's content region (`height:100%`) so the mode header
 * can pin (flexShrink:0) above a single scroll region (`flex:1; minHeight:0;
 * overflow-y:auto`). Each mode body flows inside that one scroller , the grid,
 * the list, and the transcript carry no nested scrollers, so the header never
 * scrolls away.
 *
 * Presentational: data arrives via props so Storybook exercises every state.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Segmented, type SegmentedOption } from "@/components/ui";
import { type SessionDetail, SessionDetailView } from "./SessionDetailView";
import { SessionListView, type SessionSummary } from "./SessionListView";
import { WakeCaptureDiagnostic } from "./WakeCaptureDiagnostic";

export interface WakePhotoDay {
  /** YYYY-MM-DD (UTC buckets, straight from wakePhotos.list). */
  day: string;
  photos: { path: string; capturedAt: number }[];
}

export interface ActivityPageProps {
  days: WakePhotoDay[];
  totalCount: number;
  totalBytes: number;
  /** Maps a listing path to a fetchable URL (the /media/wake-photos/ route). */
  photoUrl: (path: string) => string;
  /** Visits derived from the interaction log, newest first. */
  sessions: SessionSummary[];
  /** The expanded session, when one is selected in the Sessions mode. */
  selectedSession: SessionDetail | null;
  /** Select a session (id) or return to the list (null). */
  onSelectSession: (id: string | null) => void;
}

type ViewerMode = "grid" | "lapse" | "sessions";

const MODE_OPTIONS: readonly SegmentedOption<ViewerMode>[] = [
  { value: "grid", label: "Grid" },
  { value: "lapse", label: "Timelapse" },
  { value: "sessions", label: "Sessions" },
];

const LAPSE_FRAME_MS = 450;

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
  selectedSession,
  onSelectSession,
}: ActivityPageProps) {
  const [mode, setMode] = useState<ViewerMode>("grid");

  // Timelapse frames: chronological (oldest -> newest) so the day "replays".
  const frames = useMemo(
    () =>
      days
        .flatMap((d) => d.photos)
        .slice()
        .sort((a, b) => a.capturedAt - b.capturedAt),
    [days],
  );
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Reset playback whenever the mode flips to lapse , the component mounts
  // fresh per open (the host remounts variants), so mount + mode cover the old
  // "reopened with a stale frame index" case.
  useEffect(() => {
    if (mode === "lapse") {
      setFrameIdx(0);
      setPlaying(true);
    } else {
      setPlaying(false);
    }
  }, [mode]);

  useEffect(() => {
    if (!playing || frames.length === 0) return;
    const t = setInterval(() => setFrameIdx((i) => (i + 1) % frames.length), LAPSE_FRAME_MS);
    return () => clearInterval(t);
  }, [playing, frames.length]);

  const scrubTo = useCallback((i: number) => {
    setPlaying(false);
    setFrameIdx(i);
  }, []);

  const frame = frames[Math.min(frameIdx, Math.max(frames.length - 1, 0))];

  return (
    <div
      style={{
        // Fill the host's content region exactly so the mode header pins above
        // the single internal scroller instead of scrolling with the page.
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* Pinned mode header , count + the Grid/Timelapse/Sessions switch. */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 14 }}>
        <span className="cap">
          {totalCount} photos · {formatBytes(totalBytes)}
        </span>
        <div style={{ marginLeft: "auto", width: 260 }}>
          <Segmented options={MODE_OPTIONS} value={mode} onChange={setMode} label="Viewer mode" />
        </div>
      </div>

      {/* The ONE scroll region. Every mode body flows here; none carries its
          own scroller, so the header above never scrolls away. */}
      <div
        className="modal-scroll"
        style={{ flex: 1, minHeight: 0, overflowY: "auto" }}
        data-testid="activity-scroll"
      >
        {mode === "sessions" ? (
          // Sessions render even with zero photos on disk , a browser session
          // with dimming off is still a visit worth reading back.
          selectedSession ? (
            <SessionDetailView
              session={selectedSession}
              photoUrl={photoUrl}
              onBack={() => onSelectSession(null)}
            />
          ) : (
            <SessionListView sessions={sessions} photoUrl={photoUrl} onSelect={onSelectSession} />
          )
        ) : days.length === 0 ? (
          <div
            className="cap"
            style={{
              padding: "48px 0",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            No activity photos yet , they appear after the panel is next woken.
            {/* If the panel HAS tried to capture, say why it came up empty
                (camera denied, zero frames uploaded, …) from the wake log. */}
            <WakeCaptureDiagnostic />
          </div>
        ) : mode === "grid" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {days.map((day) => (
              <div key={day.day}>
                <div className="cap" style={{ color: "var(--ink-2)", marginBottom: 10 }}>
                  {day.day} · {day.photos.length} wakes
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(6, 1fr)",
                    gap: 10,
                  }}
                >
                  {day.photos.map((p) => (
                    <div
                      key={p.path}
                      style={{
                        position: "relative",
                        aspectRatio: "4 / 3",
                        borderRadius: 10,
                        overflow: "hidden",
                        border: "1px solid var(--hair)",
                        background: "var(--nest)",
                      }}
                    >
                      <img
                        src={photoUrl(p.path)}
                        alt={`Wake at ${formatTime(p.capturedAt)}`}
                        loading="lazy"
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
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
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                position: "relative",
                height: 620,
                borderRadius: 14,
                overflow: "hidden",
                border: "1px solid var(--hair)",
                background: "var(--nest)",
              }}
            >
              {frame ? (
                <img
                  src={photoUrl(frame.path)}
                  alt={`Wake at ${formatTime(frame.capturedAt)}`}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                  }}
                />
              ) : null}
              <div className="scan" />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                aria-label={playing ? "Pause timelapse" : "Play timelapse"}
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: "50%",
                  background: "var(--acc-dim)",
                  border: "1px solid var(--acc-line)",
                  color: "var(--acc)",
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                {playing ? "❚❚" : "▶"}
              </button>
              <input
                type="range"
                className="range range-scrub"
                style={{
                  flex: 1,
                  ["--p" as string]: `${((frameIdx + 1) / Math.max(frames.length, 1)) * 100}%`,
                }}
                min={0}
                max={Math.max(frames.length - 1, 0)}
                value={Math.min(frameIdx, Math.max(frames.length - 1, 0))}
                onChange={(e) => scrubTo(Number(e.target.value))}
                aria-label="Scrub timelapse"
              />
              <span className="cap mono">{frame ? formatTime(frame.capturedAt) : "--:--"}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
