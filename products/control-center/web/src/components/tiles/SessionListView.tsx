/**
 * SessionListView , one row per visit to the panel: the wake photo of whoever
 * approached, when, for how long, and a one-line digest of what they touched.
 * Purely presentational; data arrives via props so Storybook exercises every
 * state (spec docs/specs/2026-07-18-interaction-logging-design.md).
 */

export interface SessionSummary {
  id: string;
  startedAt: number;
  /** Null while the visit is still in progress. */
  endedAt: number | null;
  durationMs: number | null;
  eventCount: number;
  endReason: string | null;
  deviceName: string;
  /** Burst frame paths, chronological. Empty for backfilled/browser sessions. */
  photoPaths: string[];
  /** Server-computed summary of notable subjects touched; null when none. */
  digest: string | null;
}

export interface SessionListViewProps {
  sessions: SessionSummary[];
  /** Maps a photo path to a fetchable URL (the /media/wake-photos/ route). */
  photoUrl: (path: string) => string;
  onSelect: (id: string) => void;
}

export function formatSessionDuration(durationMs: number | null): string {
  if (durationMs === null) return "live";
  const s = Math.round(durationMs / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function formatStart(startedAt: number): string {
  const d = new Date(startedAt);
  const day = d.toLocaleDateString([], { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time}`;
}

export function SessionListView({ sessions, photoUrl, onSelect }: SessionListViewProps) {
  if (sessions.length === 0) {
    return (
      <div className="cap" style={{ padding: "48px 0", textAlign: "center" }}>
        No sessions yet , they appear after the panel is next woken and used.
      </div>
    );
  }

  return (
    <div
      className="modal-scroll"
      style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}
    >
      {sessions.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onSelect(s.id)}
          data-testid="session-row"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: 10,
            borderRadius: 12,
            border: "1px solid var(--hair)",
            background: "var(--nest)",
            color: "inherit",
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          <div
            style={{
              width: 96,
              aspectRatio: "4 / 3",
              borderRadius: 8,
              overflow: "hidden",
              flexShrink: 0,
              border: "1px solid var(--hair)",
              background: "var(--pane)",
            }}
          >
            {s.photoPaths[0] ? (
              <img
                src={photoUrl(s.photoPaths[0])}
                alt={`Session at ${formatStart(s.startedAt)}`}
                loading="lazy"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              // A session with no burst is a real state (dimming off, browser,
              // backfilled history) , an empty frame says so honestly.
              <div
                aria-hidden="true"
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--ink-3)",
                  fontSize: 11,
                }}
              >
                no photo
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <span className="mono" style={{ fontSize: 13 }}>
              {formatStart(s.startedAt)}
            </span>
            <span className="cap" style={{ color: "var(--ink-2)" }}>
              {formatSessionDuration(s.durationMs)} · {s.eventCount}{" "}
              {s.eventCount === 1 ? "event" : "events"}
              {s.endReason ? ` · ${s.endReason}` : ""}
            </span>
            {s.digest ? (
              <span
                className="cap"
                style={{
                  color: "var(--ink-3)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {s.digest}
              </span>
            ) : null}
          </div>
        </button>
      ))}
    </div>
  );
}
