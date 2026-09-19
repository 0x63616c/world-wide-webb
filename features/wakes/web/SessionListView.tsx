/**
 * SessionListView , one row per visit to the panel: the front-camera burst of
 * whoever approached, and when.
 *
 * It used to carry a duration, an event count, an end reason and a one-line
 * digest of what was touched, and each row opened a full transcript. All of
 * that came from the `frontend_log` ui channel, which The Simplification
 * deleted. A visit is now exactly what `wake_photo` remembers of it , an id, a
 * first frame, a device , so the row says that and stops. Rows are inert:
 * there is no longer anything behind one to open.
 *
 * Purely presentational; data arrives via props.
 */

export interface SessionSummary {
  id: string;
  startedAt: number;
  deviceName: string;
  /** Burst frame paths, chronological. Empty for backfilled sessions. */
  photoPaths: string[];
}

export interface SessionListViewProps {
  sessions: SessionSummary[];
  /** Maps a photo path to a fetchable URL (the /media/wake-photos/ route). */
  photoUrl: (path: string) => string;
}

function formatStart(startedAt: number): string {
  const d = new Date(startedAt);
  const day = d.toLocaleDateString([], { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time}`;
}

function frameCount(count: number): string {
  return count === 1 ? "1 frame" : `${count} frames`;
}

export function SessionListView({ sessions, photoUrl }: SessionListViewProps) {
  if (sessions.length === 0) {
    return (
      <div className="cap" style={{ padding: "48px 0", textAlign: "center" }}>
        No sessions yet , they appear after the panel is next woken.
      </div>
    );
  }

  return (
    // No own scroll region , the Activity page owns the single scroller so the
    // mode header can stay pinned above it (one scroller, not nested ones).
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {sessions.map((s) => (
        <div
          key={s.id}
          data-testid="session-row"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: 10,
            borderRadius: 12,
            border: "1px solid var(--hair)",
            background: "var(--nest)",
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
              {frameCount(s.photoPaths.length)} · {s.deviceName}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
