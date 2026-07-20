/**
 * Design 08 , Contact Sheet.
 *
 * A photographer's proof sheet: dense frames butted together with mono frame
 * numbers along the bottom edge and grease-pencil marks. This concept leads
 * with multi-select rather than a lightbox , tap frames to circle them in
 * amber, then Share or Delete the selection from the proof-bar. Days are ruled
 * section rows.
 */

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ui";
import { formatTime, groupByDay, MODE_META, type Photo, samplePhotos } from "./samplePhotos";
import { BackIcon, PanelFrame, PhotoFill, ShareIcon, ShareSheet, TrashIcon } from "./shared";

export function GalleryDesign08({ photos = samplePhotos }: { photos?: Photo[] }) {
  const [confirming, setConfirming] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [picks, setPicks] = useState<Set<string>>(new Set());

  const live = useMemo(() => photos.filter((p) => !deleted.has(p.id)), [photos, deleted]);
  const days = useMemo(() => groupByDay(live), [live]);

  const toggle = (id: string) =>
    setPicks((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pickCount = [...picks].filter((id) => !deleted.has(id)).length;

  return (
    <PanelFrame style={{ background: "#0b0b0b" }}>
      <header style={headerRow}>
        <button type="button" style={roundBtn} aria-label="Back to camera">
          <BackIcon />
        </button>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>
            Proof Sheet
          </h1>
          <div className="mono" style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 3 }}>
            ROLL 24 · {live.length} EXP · TAP TO MARK
          </div>
        </div>
      </header>

      <div
        style={{ flex: 1, overflowY: "auto", padding: "6px 30px 120px" }}
        className="modal-scroll"
      >
        {days.map((day) => (
          <section key={day.key} style={{ marginBottom: 22 }}>
            <div style={ruleRow}>
              <span className="mono" style={{ fontSize: 13, color: "#c9a227" }}>
                {day.label.toUpperCase()}
              </span>
              <span style={{ flex: 1, height: 1, background: "var(--hair)" }} />
              <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {day.photos.length} FR
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(8, 1fr)",
                gap: 6,
                paddingTop: 12,
              }}
            >
              {day.photos.map((p, i) => {
                const picked = picks.has(p.id);
                return (
                  <button key={p.id} type="button" onClick={() => toggle(p.id)} style={frameBtn}>
                    <div
                      style={{
                        position: "relative",
                        aspectRatio: "1 / 1",
                        background: "#000",
                        overflow: "hidden",
                      }}
                    >
                      <PhotoFill photo={p} />
                      {picked && <span style={greasePick} />}
                      {p.mode !== "photo" && (
                        <span style={frameGlyph}>{MODE_META[p.mode].glyph}</span>
                      )}
                    </div>
                    <div style={frameFoot}>
                      <span>{String(i + 1).padStart(2, "0")}A</span>
                      <span>{formatTime(p.capturedAt)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* Proof bar */}
      <div style={{ ...proofBar, transform: pickCount ? "translateY(0)" : "translateY(140%)" }}>
        <span className="mono" style={{ fontSize: 14, color: "#c9a227" }}>
          {pickCount} MARKED
        </span>
        <button
          type="button"
          style={{ ...barBtn, marginLeft: "auto" }}
          onClick={() => setPicks(new Set())}
        >
          Clear
        </button>
        <button type="button" style={barBtn} onClick={() => setSharing(true)}>
          <ShareIcon size={18} /> Share
        </button>
        <button
          type="button"
          style={{ ...barBtn, ...dangerBar }}
          onClick={() => setConfirming(true)}
        >
          <TrashIcon size={18} /> Delete
        </button>
      </div>

      <ShareSheet open={sharing} count={pickCount} onClose={() => setSharing(false)} />
      <ConfirmDialog
        open={confirming}
        tone="danger"
        title="Delete photo?"
        message={
          pickCount === 1 ? "Delete the marked photo?" : `Delete ${pickCount} marked photos?`
        }
        confirmLabel="Delete"
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setDeleted((d) => new Set([...d, ...picks]));
          setPicks(new Set());
          setConfirming(false);
        }}
      />
    </PanelFrame>
  );
}

const headerRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  padding: "24px 30px 12px",
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

const ruleRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const frameBtn: CSSProperties = {
  padding: 3,
  background: "#141414",
  border: "1px solid #1e1e1e",
  cursor: "pointer",
};

const greasePick: CSSProperties = {
  position: "absolute",
  inset: 6,
  border: "3px solid #ff7a1a",
  borderRadius: "48% 52% 50% 50% / 50% 48% 52% 50%",
  transform: "rotate(-4deg)",
  boxShadow: "0 0 0 1px rgba(255,122,26,0.3)",
  pointerEvents: "none",
};

const frameGlyph: CSSProperties = {
  position: "absolute",
  top: 3,
  right: 4,
  fontSize: 11,
  color: "rgba(255,255,255,0.85)",
  textShadow: "0 1px 3px #000",
};

const frameFoot: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "3px 2px 1px",
  fontFamily: "var(--mono)",
  fontSize: 9,
  color: "#c9a227",
};

const proofBar: CSSProperties = {
  position: "absolute",
  left: 30,
  right: 30,
  bottom: 24,
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "12px 16px",
  borderRadius: 14,
  background: "rgba(20,20,20,0.94)",
  border: "1px solid var(--hair-2)",
  backdropFilter: "blur(12px)",
  boxShadow: "0 24px 60px -20px rgba(0,0,0,0.9)",
  transition: "transform 0.25s ease",
};

const barBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  height: 40,
  padding: "0 16px",
  borderRadius: 10,
  border: "1px solid var(--hair)",
  background: "var(--nest)",
  color: "var(--ink)",
  fontFamily: "var(--ui)",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const dangerBar: CSSProperties = {
  color: "#e5484d",
  background: "rgba(229,72,77,0.12)",
  border: "1px solid rgba(229,72,77,0.35)",
};
