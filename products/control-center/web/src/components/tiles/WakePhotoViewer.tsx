import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Segmented, type SegmentedOption } from "@/components/ui";
import { type SessionDetail, SessionDetailView } from "./SessionDetailView";
import { SessionListView, type SessionSummary } from "./SessionListView";

export interface WakePhotoDay {
  /** YYYY-MM-DD (UTC buckets, straight from wakePhotos.list). */
  day: string;
  photos: { path: string; capturedAt: number }[];
}

export interface WakePhotoViewerProps {
  open: boolean;
  onClose: () => void;
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

/**
 * Fullscreen wake-photo browser behind the Wakes tile: a day-grouped grid and
 * a timelapse player over the same listing. Presentational , data arrives via
 * props so Storybook can exercise every state.
 */
export function WakePhotoViewer({
  open,
  onClose,
  days,
  totalCount,
  totalBytes,
  photoUrl,
  sessions,
  selectedSession,
  onSelectSession,
}: WakePhotoViewerProps) {
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

  // Reset playback whenever the viewer opens or the mode flips to lapse , a
  // stale frame index from a previous open would point past a shrunken list.
  useEffect(() => {
    if (open && mode === "lapse") {
      setFrameIdx(0);
      setPlaying(true);
    } else {
      setPlaying(false);
    }
  }, [open, mode]);

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
    <Modal open={open} onClose={onClose} title="Wake History" width={1180} maxHeight={920}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span className="cap">
            {totalCount} photos · {formatBytes(totalBytes)}
          </span>
          <div style={{ marginLeft: "auto", width: 260 }}>
            <Segmented options={MODE_OPTIONS} value={mode} onChange={setMode} label="Viewer mode" />
          </div>
        </div>

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
          <div className="cap" style={{ padding: "48px 0", textAlign: "center" }}>
            No wake photos yet , they appear after the panel is next woken.
          </div>
        ) : mode === "grid" ? (
          <div
            className="modal-scroll"
            style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 18 }}
          >
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
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
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
    </Modal>
  );
}
