/**
 * Design 06 , Cinema.
 *
 * Lightbox-first: the whole panel is the viewer. One photo fills the stage, a
 * slim day-labelled thumbnail rail runs along the bottom, and prev/next arrows
 * step through the whole roll in time order. Everything , share, delete, the
 * back-to-camera exit , floats over the image as translucent glass.
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
  const d = new Date(ms);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that = new Date(ms);
  that.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - that.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long" });
}

export function GalleryDesign06({ photos = samplePhotos }: { photos?: Photo[] }) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [idx, setIdx] = useState(0);

  const live = useMemo(() => photos.filter((p) => !deleted.has(p.id)), [photos, deleted]);
  const cur = live[Math.min(idx, live.length - 1)] ?? null;
  const step = (d: number) => setIdx((i) => (i + d + live.length) % live.length);

  return (
    <PanelFrame style={{ background: "#000" }}>
      {cur ? (
        <>
          {/* Stage */}
          <div style={{ position: "absolute", inset: 0 }}>
            <PhotoFill photo={cur} style={{ objectFit: "contain" }} />
            <div style={stageVignette} />
          </div>

          {/* Top glass bar */}
          <div style={topBar}>
            <button type="button" style={glassBtn} aria-label="Back to camera">
              <BackIcon />
            </button>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 17, fontWeight: 600 }}>{dayHeading(cur.capturedAt)}</div>
              <div className="mono" style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
                {formatDayStamp(cur.capturedAt)} · {formatTime(cur.capturedAt)}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                style={glassBtn}
                aria-label="Share"
                onClick={() => setSharing(true)}
              >
                <ShareIcon />
              </button>
              <button
                type="button"
                style={{ ...glassBtn, color: "#ff6b6b" }}
                aria-label="Delete"
                onClick={() => setConfirmId(cur.id)}
              >
                <TrashIcon />
              </button>
            </div>
          </div>

          {/* Mode chip */}
          {cur.mode !== "photo" && (
            <div style={modeChip}>
              {MODE_META[cur.mode].label}
              {cur.burstCount ? ` · ${cur.burstCount}` : ""}
              {cur.gifSeconds ? ` · ${cur.gifSeconds}s` : ""}
            </div>
          )}

          {/* Prev / Next */}
          <button
            type="button"
            style={{ ...arrow, left: 24 }}
            aria-label="Previous"
            onClick={() => step(-1)}
          >
            <span style={{ transform: "rotate(180deg)", display: "grid" }}>
              <ChevronRight />
            </span>
          </button>
          <button
            type="button"
            style={{ ...arrow, right: 24 }}
            aria-label="Next"
            onClick={() => step(1)}
          >
            <ChevronRight />
          </button>

          {/* Bottom filmstrip */}
          <div style={strip} className="modal-scroll">
            {live.map((p, i) => {
              const active = i === Math.min(idx, live.length - 1);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setIdx(i)}
                  style={{
                    ...stripThumb,
                    border: active ? "2px solid #fff" : "2px solid transparent",
                    opacity: active ? 1 : 0.55,
                  }}
                >
                  <PhotoFill photo={p} />
                </button>
              );
            })}
          </div>
        </>
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
            // Keep the cursor in range; the render clamps idx to the new length.
            setIdx((i) => Math.max(0, i - 1));
          }
          setConfirmId(null);
        }}
      />
    </PanelFrame>
  );
}

const stageVignette: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "radial-gradient(120% 80% at 50% 40%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.65) 100%)",
  pointerEvents: "none",
};

const topBar: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: 22,
  color: "#fff",
  background: "linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0))",
};

const glassBtn: CSSProperties = {
  width: 46,
  height: 46,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.1)",
  backdropFilter: "blur(14px)",
  color: "#fff",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
};

const modeChip: CSSProperties = {
  position: "absolute",
  top: 96,
  left: 24,
  padding: "6px 12px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.04em",
  color: "#fff",
  background: "rgba(0,0,0,0.5)",
  backdropFilter: "blur(10px)",
};

const arrow: CSSProperties = {
  position: "absolute",
  top: "46%",
  width: 52,
  height: 52,
  borderRadius: "50%",
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(0,0,0,0.4)",
  backdropFilter: "blur(10px)",
  color: "#fff",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
};

const strip: CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  display: "flex",
  gap: 8,
  padding: "16px 20px 20px",
  overflowX: "auto",
  background: "linear-gradient(0deg, rgba(0,0,0,0.7), rgba(0,0,0,0))",
};

const stripThumb: CSSProperties = {
  flex: "0 0 auto",
  width: 84,
  height: 64,
  padding: 0,
  borderRadius: 8,
  overflow: "hidden",
  background: "#111",
  cursor: "pointer",
};
