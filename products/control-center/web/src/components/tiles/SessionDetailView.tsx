/**
 * SessionDetailView , one visit, fully expanded: the burst frames across the
 * top, then the interaction transcript in order. Purely presentational.
 */

import { formatSessionDuration, type SessionSummary } from "./SessionListView";

export interface SessionEvent {
  ts: number;
  idx: number;
  msg: string;
  // Optional to match the tRPC wire type: z.unknown() infers an optional key.
  data?: unknown;
}

export type SessionDetail = SessionSummary & { events: SessionEvent[] };

export interface SessionDetailViewProps {
  session: SessionDetail;
  /** Maps a photo path to a fetchable URL (the /media/wake-photos/ route). */
  photoUrl: (path: string) => string;
  onBack: () => void;
}

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** The transcript line's subject: the logged target when the event has one. */
function targetOf(data: unknown): string {
  const target = (data as { target?: unknown } | null)?.target;
  return typeof target === "string" ? target : "";
}

export function SessionDetailView({ session, photoUrl, onBack }: SessionDetailViewProps) {
  // idx orders the transcript exactly as the panel produced it; ts breaks ties
  // for entries that predate idx (defensive , same-session rows always have it).
  const events = [...session.events].sort((a, b) => a.idx - b.idx || a.ts - b.ts);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button
          type="button"
          onClick={onBack}
          className="cap"
          style={{
            padding: "6px 14px",
            borderRadius: 8,
            border: "1px solid var(--hair)",
            background: "var(--nest)",
            color: "var(--ink-1)",
            cursor: "pointer",
          }}
        >
          ← Sessions
        </button>
        <span className="cap" style={{ color: "var(--ink-2)" }}>
          {formatSessionDuration(session.durationMs)} · {session.eventCount}{" "}
          {session.eventCount === 1 ? "event" : "events"}
          {session.endReason ? ` · ${session.endReason}` : ""} · {session.deviceName}
        </span>
      </div>

      {session.photoPaths.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
          {session.photoPaths.map((path) => (
            <div
              key={path}
              style={{
                aspectRatio: "4 / 3",
                borderRadius: 10,
                overflow: "hidden",
                border: "1px solid var(--hair)",
                background: "var(--nest)",
              }}
            >
              <img
                src={photoUrl(path)}
                alt="Wake burst frame"
                loading="lazy"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </div>
          ))}
        </div>
      ) : null}

      <div
        className="modal-scroll"
        style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}
      >
        {events.map((e) => (
          <div
            key={`${e.idx}-${e.ts}`}
            data-testid="session-event"
            style={{
              display: "grid",
              gridTemplateColumns: "90px 180px 1fr",
              gap: 12,
              padding: "6px 10px",
              borderRadius: 8,
              alignItems: "baseline",
            }}
          >
            <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {formatClock(e.ts)}
            </span>
            <span className="mono" style={{ fontSize: 12.5 }}>
              {e.msg}
            </span>
            <span className="cap" style={{ color: "var(--ink-2)" }}>
              {targetOf(e.data)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
