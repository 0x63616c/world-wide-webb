/**
 * Design 04 , Hero + Rail.
 *
 * A detail-first split: a large hero of the current photo on the left with its
 * metadata and actions inline, a day-grouped thumbnail rail on the right.
 * Selecting a thumbnail swaps the hero , no modal needed, the detail view is
 * always on screen. Share + delete act on the current hero.
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
import { BackIcon, PanelFrame, PhotoFill, ShareIcon, ShareSheet, TrashIcon } from "./shared";

export function GalleryDesign04({ photos = samplePhotos }: { photos?: Photo[] }) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [selId, setSelId] = useState<string | null>(null);

  const live = useMemo(() => photos.filter((p) => !deleted.has(p.id)), [photos, deleted]);
  const days = useMemo(() => groupByDay(live), [live]);
  const hero = live.find((p) => p.id === selId) ?? live[0] ?? null;

  return (
    <PanelFrame style={{ flexDirection: "row" }}>
      {/* Hero pane */}
      <div style={heroPane}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button type="button" style={roundBtn} aria-label="Back to camera">
            <BackIcon />
          </button>
          <div className="cap">Photo Booth · {formatCount(live)}</div>
        </div>

        {hero ? (
          <>
            <div style={heroFrame}>
              <PhotoFill photo={hero} style={{ objectFit: "contain" }} />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 16 }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>
                  {hero.caption ?? MODE_META[hero.mode].label}
                </div>
                <div className="mono" style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 6 }}>
                  {formatDayStamp(hero.capturedAt)} · {formatTime(hero.capturedAt)}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <span style={metaPill}>{hero.filter}</span>
                  <span style={metaPill}>{MODE_META[hero.mode].label}</span>
                  {hero.burstCount && <span style={metaPill}>{hero.burstCount} shots</span>}
                  {hero.gifSeconds && <span style={metaPill}>{hero.gifSeconds}s loop</span>}
                </div>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
                <button type="button" style={actionBtn} onClick={() => setSharing(true)}>
                  <ShareIcon size={18} /> Share
                </button>
                <button type="button" style={dangerAction} onClick={() => setConfirmId(hero.id)}>
                  <TrashIcon size={18} /> Delete
                </button>
              </div>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--ink-3)" }}>
            No photos
          </div>
        )}
      </div>

      {/* Rail */}
      <div style={rail} className="modal-scroll">
        {days.map((day) => (
          <div key={day.key} style={{ marginBottom: 22 }}>
            <div className="cap" style={{ marginBottom: 10 }}>
              {day.label}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {day.photos.map((p) => {
                const active = hero?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelId(p.id)}
                    style={{
                      position: "relative",
                      aspectRatio: "1 / 1",
                      padding: 0,
                      borderRadius: 12,
                      overflow: "hidden",
                      cursor: "pointer",
                      background: "var(--nest)",
                      border: active ? "2px solid var(--acc)" : "1px solid var(--hair)",
                      boxShadow: active ? "var(--acc-glow)" : "none",
                    }}
                  >
                    <PhotoFill photo={p} />
                    {p.mode !== "photo" && (
                      <span style={thumbBadge}>{MODE_META[p.mode].glyph}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

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
            if (selId === confirmId) setSelId(null);
          }
          setConfirmId(null);
        }}
      />
    </PanelFrame>
  );
}

const heroPane: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 20,
  padding: 34,
};

const heroFrame: CSSProperties = {
  flex: 1,
  minHeight: 0,
  borderRadius: 20,
  overflow: "hidden",
  border: "1px solid var(--hair)",
  background: "#000",
  position: "relative",
};

const rail: CSSProperties = {
  width: 372,
  flexShrink: 0,
  overflowY: "auto",
  padding: "28px 24px",
  borderLeft: "1px solid var(--hair)",
  background: "var(--tile)",
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

const metaPill: CSSProperties = {
  padding: "4px 11px",
  borderRadius: 999,
  fontSize: 12,
  background: "var(--nest)",
  border: "1px solid var(--hair)",
  color: "var(--ink-2)",
};

const actionBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  height: 44,
  padding: "0 18px",
  borderRadius: 12,
  border: "1px solid var(--hair)",
  background: "var(--nest)",
  color: "var(--ink)",
  fontFamily: "var(--ui)",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const dangerAction: CSSProperties = {
  ...actionBtn,
  color: "#e5484d",
  background: "rgba(229,72,77,0.12)",
  border: "1px solid rgba(229,72,77,0.35)",
};

const thumbBadge: CSSProperties = {
  position: "absolute",
  top: 6,
  right: 6,
  width: 22,
  height: 22,
  borderRadius: 999,
  display: "grid",
  placeItems: "center",
  fontSize: 12,
  color: "#fff",
  background: "rgba(0,0,0,0.6)",
};
