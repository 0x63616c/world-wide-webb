/**
 * Design 10 , Minimal Squares.
 *
 * The restrained one: an edge-to-edge uniform square grid, oversized bold date
 * headers, and almost no chrome , mode is a single tinted dot, the timestamp
 * only appears on the open photo. A quiet, typographic lightbox carries share
 * and delete. The pure counterpoint to the loud sticker book.
 */

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ui";
import {
  formatCount,
  formatDayStamp,
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

export function GalleryDesign10({ photos = samplePhotos }: { photos?: Photo[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [deleted, setDeleted] = useState<Set<string>>(new Set());

  const live = useMemo(() => photos.filter((p) => !deleted.has(p.id)), [photos, deleted]);
  const days = useMemo(() => groupByDay(live), [live]);
  const open = live.find((p) => p.id === openId) ?? null;

  return (
    <PanelFrame>
      <header style={headerRow}>
        <button type="button" style={roundBtn} aria-label="Back to camera">
          <BackIcon />
        </button>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
          Photos
        </h1>
        <span className="cap" style={{ marginLeft: "auto" }}>
          {formatCount(live)}
        </span>
      </header>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 0 40px" }} className="modal-scroll">
        {days.map((day) => (
          <section key={day.key}>
            <h2 style={dateHeader}>
              {day.label}
              <span
                style={{ fontSize: 16, fontWeight: 500, color: "var(--ink-3)", marginLeft: 12 }}
              >
                {day.photos.length}
              </span>
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 2 }}>
              {day.photos.map((p) => (
                <button key={p.id} type="button" onClick={() => setOpenId(p.id)} style={cell}>
                  <PhotoFill photo={p} />
                  {p.mode !== "photo" && (
                    <span style={{ ...dot, background: MODE_META[p.mode].tone }} />
                  )}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {open && (
        <div style={overlay}>
          <button type="button" aria-label="Close" onClick={() => setOpenId(null)} style={scrim} />
          <div
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 20,
            }}
          >
            <div style={imgWrap}>
              <PhotoFill photo={open} style={{ objectFit: "contain" }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <div style={{ textAlign: "right", marginRight: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>
                  {formatDayStamp(open.capturedAt)}
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 2 }}
                >
                  {formatTime(open.capturedAt)} · {open.filter} · {MODE_META[open.mode].label}
                </div>
              </div>
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
                onClick={() => setConfirmId(open.id)}
              >
                <TrashIcon />
              </button>
              <button
                type="button"
                style={glassBtn}
                aria-label="Close"
                onClick={() => setOpenId(null)}
              >
                <CloseIcon />
              </button>
            </div>
          </div>
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
  padding: "24px 24px 14px",
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

const dateHeader: CSSProperties = {
  margin: 0,
  padding: "26px 24px 14px",
  fontSize: 34,
  fontWeight: 800,
  letterSpacing: "-0.03em",
};

const cell: CSSProperties = {
  position: "relative",
  aspectRatio: "1 / 1",
  padding: 0,
  border: "none",
  background: "var(--nest)",
  cursor: "pointer",
  overflow: "hidden",
};

const dot: CSSProperties = {
  position: "absolute",
  top: 8,
  right: 8,
  width: 8,
  height: 8,
  borderRadius: "50%",
  boxShadow: "0 0 0 2px rgba(0,0,0,0.4)",
};

const overlay: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 60,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0,0,0,0.9)",
};

const scrim: CSSProperties = {
  position: "absolute",
  inset: 0,
  border: "none",
  background: "transparent",
};

const imgWrap: CSSProperties = {
  position: "relative",
  width: 760,
  height: 720,
  borderRadius: 10,
  overflow: "hidden",
  background: "#000",
};

const glassBtn: CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.1)",
  backdropFilter: "blur(14px)",
  color: "#fff",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
};
