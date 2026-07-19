/**
 * ActivityPage , the full-page (1366x1024) overlay behind the Activity tile.
 *
 * Mechanics copied from settings-page/SettingsPage.tsx: a body-portal fixed
 * overlay filling the board, safe-area padded, with the three lifecycle effects
 * (registerOpenModal so the board freezes + idle-reset can dismiss us,
 * Escape-to-close, and the interaction open/close log). Unlike Settings it is a
 * single column , a back + heading framing row over one content region.
 *
 * The content region gives its child a DEFINITE height (`flex:1; minHeight:0;
 * overflow:hidden`) so the mode header can pin (flexShrink:0) above a single
 * scroll region (`flex:1; minHeight:0; overflow-y:auto`). Each mode body flows
 * inside that one scroller , the grid, the list, and the transcript no longer
 * carry their own nested scrollers, so the header never scrolls away.
 *
 * Presentational: data arrives via props so Storybook exercises every state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Segmented, type SegmentedOption } from "@/components/ui";
import { interaction } from "../../lib/log/interaction";
import { registerOpenModal } from "../../lib/modal-open-store";
import { BackButton } from "../settings-page/blocks";
import { type SessionDetail, SessionDetailView } from "./SessionDetailView";
import { SessionListView, type SessionSummary } from "./SessionListView";

export interface WakePhotoDay {
  /** YYYY-MM-DD (UTC buckets, straight from wakePhotos.list). */
  day: string;
  photos: { path: string; capturedAt: number }[];
}

export interface ActivityPageProps {
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

export function ActivityPage({
  open,
  onClose,
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

  // Reset playback whenever the page opens or the mode flips to lapse , a stale
  // frame index from a previous open would point past a shrunken list.
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

  // Freeze the board's pan for the overlay's lifetime and let the board's idle
  // reset dismiss it. Ref-routed so a fresh onClose closure never re-registers.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    return registerOpenModal(() => onCloseRef.current());
  }, [open]);

  // Interaction log for the open/close lifecycle, mirroring Modal / SettingsPage.
  useEffect(() => {
    if (!open) return;
    const target = "modal.Activity full page";
    interaction("modal", "open", target);
    return () => interaction("modal", "close", target);
  }, [open]);

  // Escape-to-close, only while open.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const frame = frames[Math.min(frameIdx, Math.max(frames.length - 1, 0))];

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
        color: "var(--ink)",
        fontFamily: "var(--ui)",
        overflow: "hidden",
        // Keep content clear of the notch / Dynamic Island and home indicator
        // (index.html sets viewport-fit=cover). Padding (not inset) so the
        // background still fills those regions. Copied from SettingsPage.
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
        boxSizing: "border-box",
      }}
    >
      {/* Framing row: back to the board + the page heading. */}
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "24px 64px 20px",
        }}
      >
        <BackButton onClick={onClose} />
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>Activity</h1>
      </div>

      {/* Content region , definite height so the mode header can pin above a
          single scroll region. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          padding: "0 64px 40px",
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
            <div className="cap" style={{ padding: "48px 0", textAlign: "center" }}>
              No activity photos yet , they appear after the panel is next woken.
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
    </div>,
    document.body,
  );
}
