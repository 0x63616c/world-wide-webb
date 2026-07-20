/**
 * Design 07 , Sticker Book.
 *
 * The playful one: chunky rounded cards with thick white "sticker" borders,
 * candy-coloured mode stickers peeling off the corner, and a bouncy day header
 * as a big rounded tab. Tapping pops a photo up big with sticker-style share
 * and delete buttons. Loud on purpose , the counterpoint to the minimal grids.
 */

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ui";
import {
  formatCount,
  formatTime,
  groupByDay,
  type Photo,
  type PhotoMode,
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

const STICKER: Record<PhotoMode, { label: string; bg: string; fg: string }> = {
  photo: { label: "", bg: "", fg: "" },
  burst: { label: "BURST!", bg: "#6fdbcb", fg: "#04302a" },
  "4-frame": { label: "4-UP", bg: "#8ec5fc", fg: "#0a1f4d" },
  gif: { label: "GIF", bg: "#ffd26f", fg: "#4d3300" },
};

const DAY_TINT = ["#ff6a88", "#8ec5fc", "#a8ff78", "#ffd26f", "#c471f5"];

function tilt(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return ((h % 700) / 100 - 3.5) * 1.0;
}

export function GalleryDesign07({ photos = samplePhotos }: { photos?: Photo[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [deleted, setDeleted] = useState<Set<string>>(new Set());

  const live = useMemo(() => photos.filter((p) => !deleted.has(p.id)), [photos, deleted]);
  const days = useMemo(() => groupByDay(live), [live]);
  const open = live.find((p) => p.id === openId) ?? null;

  return (
    <PanelFrame
      style={{ background: "radial-gradient(130% 90% at 80% -10%, #1b1226, #0a0a0a 55%)" }}
    >
      <header style={headerRow}>
        <button type="button" style={bubbleBtn} aria-label="Back to camera">
          <BackIcon />
        </button>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: "-0.03em" }}>
          Sticker Book
        </h1>
        <span
          style={{
            marginLeft: 6,
            padding: "5px 12px",
            borderRadius: 999,
            background: "#ff6a88",
            color: "#4d0a1c",
            fontSize: 13,
            fontWeight: 800,
          }}
        >
          {formatCount(live)}
        </span>
      </header>

      <div
        style={{ flex: 1, overflowY: "auto", padding: "8px 34px 44px" }}
        className="modal-scroll"
      >
        {days.map((day, di) => (
          <section key={day.key} style={{ marginBottom: 30 }}>
            <div
              style={{
                display: "inline-block",
                padding: "8px 20px",
                borderRadius: "18px 18px 18px 4px",
                background: DAY_TINT[di % DAY_TINT.length],
                color: "#1a1020",
                fontSize: 18,
                fontWeight: 800,
                transform: "rotate(-1.5deg)",
                boxShadow: "0 8px 20px -10px rgba(0,0,0,0.8)",
              }}
            >
              {day.label} · {day.photos.length}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 20, paddingTop: 18 }}>
              {day.photos.map((p) => {
                const st = STICKER[p.mode];
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setOpenId(p.id)}
                    style={{ ...stickerCard, transform: `rotate(${tilt(p.id)}deg)` }}
                  >
                    <div
                      style={{
                        position: "relative",
                        aspectRatio: "1 / 1",
                        borderRadius: 14,
                        overflow: "hidden",
                      }}
                    >
                      <PhotoFill photo={p} />
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 4px 2px",
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#101010" }}>
                        {formatTime(p.capturedAt)}
                      </span>
                      {st.label && (
                        <span style={{ ...sticker, background: st.bg, color: st.fg }}>
                          {st.label}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {open && (
        <div style={overlay}>
          <button type="button" aria-label="Close" onClick={() => setOpenId(null)} style={scrim} />
          <div style={popCard}>
            <div
              style={{
                position: "relative",
                aspectRatio: "1 / 1",
                borderRadius: 18,
                overflow: "hidden",
                background: "#000",
              }}
            >
              <PhotoFill photo={open} />
            </div>
            <div
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 4px 2px" }}
            >
              <div style={{ fontSize: 20, fontWeight: 800, color: "#101010" }}>
                {open.caption ?? formatTime(open.capturedAt)}
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
                <button
                  type="button"
                  style={{ ...popBtn, background: "#8ec5fc", color: "#0a1f4d" }}
                  onClick={() => setSharing(true)}
                  aria-label="Share"
                >
                  <ShareIcon size={20} />
                </button>
                <button
                  type="button"
                  style={{ ...popBtn, background: "#ff6a88", color: "#4d0a1c" }}
                  onClick={() => setConfirmId(open.id)}
                  aria-label="Delete"
                >
                  <TrashIcon size={20} />
                </button>
                <button
                  type="button"
                  style={{ ...popBtn, background: "#e8e8e8", color: "#101010" }}
                  onClick={() => setOpenId(null)}
                  aria-label="Close"
                >
                  <CloseIcon size={20} />
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
        message="Peel this sticker out of the book?"
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

const bubbleBtn: CSSProperties = {
  width: 46,
  height: 46,
  borderRadius: 16,
  border: "none",
  background: "#fff",
  color: "#101010",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  boxShadow: "0 6px 16px -6px rgba(0,0,0,0.6)",
};

const stickerCard: CSSProperties = {
  width: 196,
  padding: 8,
  background: "#fff",
  border: "none",
  borderRadius: 20,
  cursor: "pointer",
  boxShadow: "0 14px 30px -14px rgba(0,0,0,0.75)",
};

const sticker: CSSProperties = {
  padding: "3px 9px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.03em",
};

const overlay: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 60,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(10,6,16,0.8)",
  backdropFilter: "blur(8px)",
};

const scrim: CSSProperties = {
  position: "absolute",
  inset: 0,
  border: "none",
  background: "transparent",
};

const popCard: CSSProperties = {
  position: "relative",
  width: 560,
  padding: 14,
  background: "#fff",
  borderRadius: 28,
  boxShadow: "0 50px 120px -30px rgba(0,0,0,0.9)",
};

const popBtn: CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: 16,
  border: "none",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
};
