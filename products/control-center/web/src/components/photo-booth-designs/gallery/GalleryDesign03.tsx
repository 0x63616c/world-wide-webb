/**
 * Design 03 , Filmstrip Reel.
 *
 * Each day is a horizontal strip of 35mm film , sprocket holes top and bottom,
 * frames butted edge to edge, scrolling sideways. A tapped frame lifts into a
 * loupe-style detail over the reels with share + delete. Mono frame numbers
 * and edge markings sell the film-stock feel.
 */

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ui";
import {
  formatCount,
  formatTime,
  groupByDay,
  MODE_META,
  type Photo,
  samplePhotos,
} from "./samplePhotos";
import {
  BackIcon,
  CloseIcon,
  PanelFrame,
  PhotoFill,
  ShareIcon,
  ShareSheet,
  TrashIcon,
} from "./shared";

function Sprockets() {
  return (
    <div style={{ display: "flex", gap: 12, padding: "5px 10px", justifyContent: "flex-start" }}>
      {Array.from({ length: 26 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: decorative fixed row of sprocket holes.
        <span key={i} style={sprocket} />
      ))}
    </div>
  );
}

export function GalleryDesign03({ photos = samplePhotos }: { photos?: Photo[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [deleted, setDeleted] = useState<Set<string>>(new Set());

  const live = useMemo(() => photos.filter((p) => !deleted.has(p.id)), [photos, deleted]);
  const days = useMemo(() => groupByDay(live), [live]);
  const open = live.find((p) => p.id === openId) ?? null;

  return (
    <PanelFrame style={{ background: "#060606" }}>
      <header style={headerRow}>
        <button type="button" style={roundBtn} aria-label="Back to camera">
          <BackIcon />
        </button>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" }}>
          Reels
        </h1>
        <span className="cap" style={{ marginLeft: 4 }}>
          {formatCount(live)}
        </span>
      </header>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0 40px" }} className="modal-scroll">
        {days.map((day) => (
          <section key={day.key} style={{ marginBottom: 26 }}>
            <div
              style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "0 34px 10px" }}
            >
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{day.label}</h2>
              <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {day.photos.length} frames
              </span>
            </div>
            <div style={{ overflowX: "auto", padding: "0 34px" }} className="modal-scroll">
              <div style={filmStock}>
                <Sprockets />
                <div style={{ display: "flex" }}>
                  {day.photos.map((p, i) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setOpenId(p.id)}
                      style={filmFrame}
                    >
                      <div
                        style={{
                          position: "relative",
                          width: 200,
                          height: 148,
                          background: "#000",
                        }}
                      >
                        <PhotoFill photo={p} />
                        {p.mode !== "photo" && (
                          <span style={frameBadge}>{MODE_META[p.mode].label}</span>
                        )}
                      </div>
                      <div style={frameEdge}>
                        <span>
                          {day.key.toString().slice(-2)}A · {String(i + 1).padStart(2, "0")}
                        </span>
                        <span>{formatTime(p.capturedAt)}</span>
                      </div>
                    </button>
                  ))}
                </div>
                <Sprockets />
              </div>
            </div>
          </section>
        ))}
      </div>

      {open && (
        <div style={overlay}>
          <button type="button" aria-label="Close" onClick={() => setOpenId(null)} style={scrim} />
          <div style={loupe}>
            <div style={{ position: "relative", width: 720, height: 500, background: "#000" }}>
              <PhotoFill photo={open} style={{ objectFit: "contain" }} />
              <div style={loupeRing} />
            </div>
            <div style={loupeBar}>
              <span className="mono" style={{ fontSize: 13, color: "var(--ink-2)" }}>
                {formatTime(open.capturedAt)} · {open.filter} · {MODE_META[open.mode].label}
              </span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
                <button
                  type="button"
                  style={roundBtn}
                  aria-label="Share"
                  onClick={() => setSharing(true)}
                >
                  <ShareIcon />
                </button>
                <button
                  type="button"
                  style={dangerBtn}
                  aria-label="Delete"
                  onClick={() => setConfirmId(open.id)}
                >
                  <TrashIcon />
                </button>
                <button
                  type="button"
                  style={roundBtn}
                  aria-label="Close"
                  onClick={() => setOpenId(null)}
                >
                  <CloseIcon />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ShareSheet open={sharing} onClose={() => setSharing(false)} />
      <ConfirmDialog
        open={confirmId !== null}
        tone="danger"
        title="Delete photo?"
        message="Cut this frame from the reel?"
        confirmLabel="Delete"
        onClose={() => setConfirmId(null)}
        onConfirm={() => {
          if (confirmId) {
            setDeleted((d) => new Set(d).add(confirmId));
            if (openId === confirmId) setOpenId(null);
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

const dangerBtn: CSSProperties = {
  ...roundBtn,
  color: "#e5484d",
  background: "rgba(229,72,77,0.12)",
  border: "1px solid rgba(229,72,77,0.35)",
};

const filmStock: CSSProperties = {
  display: "inline-block",
  background: "#111",
  borderRadius: 4,
  border: "1px solid #1c1c1c",
};

const sprocket: CSSProperties = {
  width: 14,
  height: 10,
  borderRadius: 2,
  background: "#050505",
  flex: "0 0 auto",
};

const filmFrame: CSSProperties = {
  padding: "6px 6px 0",
  background: "transparent",
  border: "none",
  borderRight: "1px solid #1c1c1c",
  cursor: "pointer",
};

const frameBadge: CSSProperties = {
  position: "absolute",
  top: 6,
  left: 6,
  padding: "2px 7px",
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  color: "#fff",
  background: "rgba(0,0,0,0.6)",
};

const frameEdge: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  width: 200,
  padding: "5px 2px 6px",
  fontFamily: "var(--mono)",
  fontSize: 10,
  color: "#c9a227",
  letterSpacing: "0.04em",
};

const overlay: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 60,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0,0,0,0.85)",
};

const scrim: CSSProperties = {
  position: "absolute",
  inset: 0,
  border: "none",
  background: "transparent",
};

const loupe: CSSProperties = {
  position: "relative",
  borderRadius: 16,
  overflow: "hidden",
  border: "1px solid var(--hair-2)",
  background: "var(--tile)",
  boxShadow: "0 50px 120px -30px rgba(0,0,0,0.9)",
};

const loupeRing: CSSProperties = {
  position: "absolute",
  inset: 0,
  boxShadow: "inset 0 0 120px -30px rgba(0,0,0,0.9)",
  pointerEvents: "none",
};

const loupeBar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "14px 18px",
  borderTop: "1px solid var(--hair)",
};
