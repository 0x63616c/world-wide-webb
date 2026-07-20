/**
 * Design 09 , Card Deck.
 *
 * One shot at a time as a big card, a shuffled stack peeking behind it, and a
 * row of chunky controls beneath , back, share, delete, next. The card itself
 * is the detail view; there is no separate lightbox. A slim progress track and
 * a floating day badge orient you as you thumb through the roll in time order.
 */

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ui";
import { formatDayStamp, formatTime, MODE_META, type Photo, samplePhotos } from "./samplePhotos";
import {
  BackIcon,
  ChevronRight,
  PanelFrame,
  PhotoFill,
  ShareIcon,
  ShareSheet,
  TrashIcon,
} from "./shared";

function dayHeading(ms: number): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that = new Date(ms);
  that.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - that.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return new Date(ms).toLocaleDateString([], { weekday: "long" });
}

export function GalleryDesign09({ photos = samplePhotos }: { photos?: Photo[] }) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [idx, setIdx] = useState(0);

  const live = useMemo(() => photos.filter((p) => !deleted.has(p.id)), [photos, deleted]);
  const pos = Math.min(idx, Math.max(live.length - 1, 0));
  const cur = live[pos] ?? null;
  const behind = live.slice(pos + 1, pos + 3);

  return (
    <PanelFrame style={{ background: "radial-gradient(120% 90% at 50% 0%, #10131b, #060606 60%)" }}>
      <header style={headerRow}>
        <button type="button" style={roundBtn} aria-label="Back to camera">
          <BackIcon />
        </button>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>Deck</h1>
        <span className="cap" style={{ marginLeft: "auto" }}>
          {live.length ? `${pos + 1} / ${live.length}` : "0"}
        </span>
      </header>

      {cur ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 28,
          }}
        >
          <div style={{ position: "relative", width: 560, height: 620 }}>
            {behind.map((p, i) => (
              <div
                key={p.id}
                style={{
                  ...cardBase,
                  transform: `translateY(${(i + 1) * 14}px) scale(${1 - (i + 1) * 0.05}) rotate(${(i + 1) * 2}deg)`,
                  filter: "brightness(0.6)",
                  zIndex: 1,
                }}
              >
                <PhotoFill photo={p} />
              </div>
            ))}
            <div style={{ ...cardBase, zIndex: 3 }}>
              <PhotoFill photo={cur} />
              <div style={cardOverlay}>
                <span style={dayBadge}>{dayHeading(cur.capturedAt)}</span>
                <div
                  style={{ marginTop: "auto", display: "flex", alignItems: "flex-end", gap: 10 }}
                >
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 700 }}>
                      {cur.caption ?? MODE_META[cur.mode].label}
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: 12.5, color: "rgba(255,255,255,0.75)", marginTop: 4 }}
                    >
                      {formatDayStamp(cur.capturedAt)} · {formatTime(cur.capturedAt)} · {cur.filter}
                    </div>
                  </div>
                  {cur.mode !== "photo" && (
                    <span style={cardMode}>{MODE_META[cur.mode].label}</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <button
              type="button"
              style={ctrl}
              aria-label="Previous"
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
            >
              <span style={{ transform: "rotate(180deg)", display: "grid" }}>
                <ChevronRight />
              </span>
            </button>
            <button
              type="button"
              style={{ ...ctrl, ...shareCtrl }}
              aria-label="Share"
              onClick={() => setSharing(true)}
            >
              <ShareIcon />
            </button>
            <button
              type="button"
              style={{ ...ctrl, ...dangerCtrl, width: 68, height: 68 }}
              aria-label="Delete"
              onClick={() => setConfirmId(cur.id)}
            >
              <TrashIcon size={26} />
            </button>
            <button
              type="button"
              style={{ ...ctrl, ...nextCtrl }}
              aria-label="Next"
              onClick={() => setIdx((i) => Math.min(live.length - 1, i + 1))}
            >
              <ChevronRight />
            </button>
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            {live.map((p, i) => (
              <span
                key={p.id}
                style={{
                  width: i === pos ? 22 : 7,
                  height: 7,
                  borderRadius: 999,
                  background: i === pos ? "var(--acc)" : "var(--hair-2)",
                  transition: "width 0.2s ease",
                }}
              />
            ))}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--ink-3)" }}>
          No photos
        </div>
      )}

      <ShareSheet open={sharing} onClose={() => setSharing(false)} />
      <ConfirmDialog
        open={confirmId !== null}
        tone="danger"
        title="Delete photo?"
        message="This photo will be removed from your booth."
        confirmLabel="Delete"
        onClose={() => setConfirmId(null)}
        onConfirm={() => {
          if (confirmId) {
            setDeleted((d) => new Set(d).add(confirmId));
            setIdx((i) => Math.max(0, Math.min(i, live.length - 2)));
          }
          setConfirmId(null);
        }}
      />
    </PanelFrame>
  );
}

const headerRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  padding: "24px 34px 12px",
  flexShrink: 0,
};

const roundBtn: CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 12,
  border: "1px solid var(--hair)",
  background: "var(--nest)",
  color: "var(--ink)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
};

const cardBase: CSSProperties = {
  position: "absolute",
  inset: 0,
  borderRadius: 24,
  overflow: "hidden",
  background: "#000",
  border: "1px solid var(--hair-2)",
  boxShadow: "0 40px 90px -30px rgba(0,0,0,0.9)",
};

const cardOverlay: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  padding: 22,
  background:
    "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.75) 100%)",
  color: "#fff",
};

const dayBadge: CSSProperties = {
  alignSelf: "flex-start",
  padding: "6px 12px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 700,
  background: "rgba(0,0,0,0.45)",
  backdropFilter: "blur(10px)",
};

const cardMode: CSSProperties = {
  marginLeft: "auto",
  padding: "4px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 700,
  background: "rgba(255,255,255,0.16)",
  backdropFilter: "blur(8px)",
};

const ctrl: CSSProperties = {
  width: 58,
  height: 58,
  borderRadius: "50%",
  border: "1px solid var(--hair-2)",
  background: "var(--nest)",
  color: "var(--ink)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
};

const shareCtrl: CSSProperties = {
  color: "var(--acc)",
  background: "var(--acc-dim)",
  border: "1px solid var(--acc-line)",
};

const dangerCtrl: CSSProperties = {
  color: "#ff6b6b",
  background: "rgba(229,72,77,0.14)",
  border: "1px solid rgba(229,72,77,0.4)",
};

const nextCtrl: CSSProperties = {
  color: "#fff",
  background: "var(--acc)",
  border: "1px solid var(--acc)",
};
