/**
 * Design 05 , Timeline.
 *
 * A vertical journal: a spine runs down the left with a node per day; each
 * day's shots flow to the right of it as a wrapped row, newest day at the top.
 * A big date sits at each node with the shot count. Tapping opens a centered
 * lightbox with share + delete. Reads like scrolling back through time.
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

export function GalleryDesign05({ photos = samplePhotos }: { photos?: Photo[] }) {
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
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" }}>
          Timeline
        </h1>
        <span className="cap" style={{ marginLeft: 4 }}>
          {formatCount(live)}
        </span>
      </header>

      <div
        style={{ flex: 1, overflowY: "auto", padding: "8px 40px 48px" }}
        className="modal-scroll"
      >
        {days.map((day, di) => (
          <div key={day.key} style={{ display: "flex", gap: 26 }}>
            {/* Spine */}
            <div style={{ width: 120, flexShrink: 0, position: "relative", textAlign: "right" }}>
              <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>
                {day.label}
              </div>
              <div className="cap" style={{ marginTop: 4 }}>
                {day.photos.length} shots
              </div>
              <span style={{ ...node, top: 6 }} />
              {di < days.length - 1 && <span style={spine} />}
            </div>
            {/* Day's photos */}
            <div style={{ flex: 1, paddingBottom: 34, display: "flex", flexWrap: "wrap", gap: 14 }}>
              {day.photos.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setOpenId(p.id)}
                  style={{ ...card, width: p.aspect === "landscape" ? 232 : 168 }}
                >
                  <div style={{ position: "relative", aspectRatio: cardAspect(p) }}>
                    <PhotoFill photo={p} />
                    {p.mode !== "photo" && <span style={badge}>{MODE_META[p.mode].label}</span>}
                    <span style={stamp}>{formatTime(p.capturedAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {open && (
        <div style={overlay}>
          <button type="button" aria-label="Close" onClick={() => setOpenId(null)} style={scrim} />
          <div style={panel}>
            <div style={{ position: "relative", flex: 1, minHeight: 0, background: "#000" }}>
              <PhotoFill photo={open} style={{ objectFit: "contain" }} />
            </div>
            <div style={bar}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{formatTime(open.capturedAt)}</div>
                <div className="cap" style={{ marginTop: 3 }}>
                  {open.filter} · {MODE_META[open.mode].label}
                </div>
              </div>
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

function cardAspect(p: Photo): string {
  if (p.mode === "4-frame") return "1 / 1";
  if (p.aspect === "landscape") return "16 / 10";
  if (p.aspect === "portrait") return "3 / 4";
  return "1 / 1";
}

const headerRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  padding: "24px 40px 12px",
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

const node: CSSProperties = {
  position: "absolute",
  right: -30,
  width: 14,
  height: 14,
  borderRadius: "50%",
  background: "var(--acc)",
  boxShadow: "var(--acc-glow)",
};

const spine: CSSProperties = {
  position: "absolute",
  right: -24,
  top: 20,
  bottom: -14,
  width: 2,
  background: "var(--hair-2)",
};

const card: CSSProperties = {
  padding: 0,
  border: "1px solid var(--hair)",
  borderRadius: 14,
  overflow: "hidden",
  background: "var(--nest)",
  cursor: "pointer",
};

const badge: CSSProperties = {
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

const stamp: CSSProperties = {
  position: "absolute",
  bottom: 6,
  right: 8,
  fontFamily: "var(--mono)",
  fontSize: 10.5,
  color: "rgba(255,255,255,0.9)",
  textShadow: "0 1px 4px #000",
};

const overlay: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 60,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0,0,0,0.82)",
  backdropFilter: "blur(8px)",
};

const scrim: CSSProperties = {
  position: "absolute",
  inset: 0,
  border: "none",
  background: "transparent",
};

const panel: CSSProperties = {
  position: "relative",
  width: 860,
  height: 800,
  display: "flex",
  flexDirection: "column",
  borderRadius: 20,
  overflow: "hidden",
  border: "1px solid var(--hair-2)",
  background: "var(--tile)",
  boxShadow: "0 40px 120px -30px rgba(0,0,0,0.9)",
};

const bar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "16px 20px",
  borderTop: "1px solid var(--hair)",
};
