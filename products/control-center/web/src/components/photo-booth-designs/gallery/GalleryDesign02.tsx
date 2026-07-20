/**
 * Design 02 , Polaroid Pinboard.
 *
 * Photos as scattered polaroids tacked to a dark felt wall, each tilted a
 * little, with a handwritten date on the white lip and a pin. Days are pinned
 * paper labels. Tapping a polaroid lifts it into a straightened detail card
 * with share + delete.
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

/** Deterministic per-id tilt so a polaroid never jumps between renders. */
function tilt(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return ((h % 900) / 100 - 4.5) * 1.0;
}

export function GalleryDesign02({ photos = samplePhotos }: { photos?: Photo[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [deleted, setDeleted] = useState<Set<string>>(new Set());

  const live = useMemo(() => photos.filter((p) => !deleted.has(p.id)), [photos, deleted]);
  const days = useMemo(() => groupByDay(live), [live]);
  const open = live.find((p) => p.id === openId) ?? null;

  return (
    <PanelFrame
      style={{
        background: "radial-gradient(120% 80% at 20% 0%, #14110c 0%, #0a0a0a 60%, #050505 100%)",
      }}
    >
      <header style={headerRow}>
        <button type="button" style={pinBtn} aria-label="Back to camera">
          <BackIcon />
        </button>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" }}>
          The Wall
        </h1>
        <span className="cap" style={{ marginLeft: 4 }}>
          {formatCount(live)}
        </span>
      </header>

      <div
        style={{ flex: 1, overflowY: "auto", padding: "6px 34px 40px" }}
        className="modal-scroll"
      >
        {days.map((day) => (
          <section key={day.key} style={{ marginBottom: 30 }}>
            <div style={paperLabel}>{day.label}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "26px 30px", paddingTop: 14 }}>
              {day.photos.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setOpenId(p.id)}
                  style={{ ...polaroid, transform: `rotate(${tilt(p.id)}deg)` }}
                >
                  <span style={pin} />
                  <div style={polaroidPhoto}>
                    <PhotoFill photo={p} />
                    {p.mode !== "photo" && (
                      <span style={cornerBadge}>{MODE_META[p.mode].label}</span>
                    )}
                  </div>
                  <div style={polaroidCaption}>{p.caption ?? formatTime(p.capturedAt)}</div>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {open && (
        <div style={overlay}>
          <button type="button" aria-label="Close" onClick={() => setOpenId(null)} style={scrim} />
          <div style={{ ...polaroidBig }}>
            <div style={{ position: "relative", aspectRatio: "1 / 1", background: "#000" }}>
              <PhotoFill photo={open} />
            </div>
            <div style={{ padding: "16px 18px 20px" }}>
              <div style={{ fontSize: 22, fontFamily: "var(--mono)", color: "#1a1a1a" }}>
                {open.caption ?? "untitled"}
              </div>
              <div style={{ fontSize: 13, color: "#6a6a6a", marginTop: 4 }}>
                {formatTime(open.capturedAt)} · {open.filter}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button type="button" style={darkPill} onClick={() => setSharing(true)}>
                  <ShareIcon size={18} /> Share
                </button>
                <button type="button" style={dangerPill} onClick={() => setConfirmId(open.id)}>
                  <TrashIcon size={18} /> Delete
                </button>
                <button
                  type="button"
                  style={{ ...darkPill, marginLeft: "auto", padding: "0 14px" }}
                  onClick={() => setOpenId(null)}
                  aria-label="Close"
                >
                  <CloseIcon size={18} />
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
        message="Take this polaroid off the wall?"
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
  padding: "24px 34px 10px",
  flexShrink: 0,
};

const pinBtn: CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 12,
  border: "1px solid var(--hair)",
  background: "rgba(255,255,255,0.05)",
  color: "var(--ink)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
};

const paperLabel: CSSProperties = {
  display: "inline-block",
  padding: "6px 16px",
  background: "#efe9d8",
  color: "#2a2620",
  fontFamily: "var(--mono)",
  fontSize: 14,
  borderRadius: 3,
  transform: "rotate(-1.4deg)",
  boxShadow: "0 6px 18px -8px rgba(0,0,0,0.7)",
};

const polaroid: CSSProperties = {
  width: 210,
  padding: "12px 12px 0",
  background: "#f7f5ef",
  border: "none",
  borderRadius: 4,
  boxShadow: "0 18px 34px -18px rgba(0,0,0,0.85)",
  cursor: "pointer",
  position: "relative",
  transition: "transform 0.15s ease",
};

const pin: CSSProperties = {
  position: "absolute",
  top: -8,
  left: "50%",
  width: 16,
  height: 16,
  marginLeft: -8,
  borderRadius: "50%",
  background: "radial-gradient(circle at 35% 30%, #ff6a88, #b3243f)",
  boxShadow: "0 3px 6px rgba(0,0,0,0.5)",
};

const polaroidPhoto: CSSProperties = {
  position: "relative",
  aspectRatio: "1 / 1",
  overflow: "hidden",
  background: "#000",
  borderRadius: 1,
};

const cornerBadge: CSSProperties = {
  position: "absolute",
  top: 6,
  right: 6,
  padding: "2px 7px",
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  color: "#fff",
  background: "rgba(0,0,0,0.6)",
};

const polaroidCaption: CSSProperties = {
  padding: "12px 4px 16px",
  textAlign: "center",
  fontFamily: "var(--mono)",
  fontSize: 15,
  color: "#2a2620",
};

const overlay: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 60,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0,0,0,0.78)",
  backdropFilter: "blur(6px)",
};

const scrim: CSSProperties = {
  position: "absolute",
  inset: 0,
  border: "none",
  background: "transparent",
};

const polaroidBig: CSSProperties = {
  position: "relative",
  width: 480,
  padding: 16,
  background: "#f7f5ef",
  borderRadius: 6,
  boxShadow: "0 50px 120px -30px rgba(0,0,0,0.9)",
};

const darkPill: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  height: 42,
  padding: "0 18px",
  borderRadius: 999,
  border: "none",
  background: "#1a1a1a",
  color: "#f2f2f2",
  fontFamily: "var(--ui)",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const dangerPill: CSSProperties = {
  ...darkPill,
  background: "#b3243f",
  color: "#fff",
};
