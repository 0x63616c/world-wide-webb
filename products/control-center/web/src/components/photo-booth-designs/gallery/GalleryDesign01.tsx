/**
 * Design 01 , Clean Masonry.
 *
 * A calm, Vercel-black masonry wall: filter chips, day-grouped columns, and a
 * full-bleed lightbox with share + delete. This concept also owns the gallery
 * empty state (rendered when `photos` is empty), so it doubles as the "Empty"
 * story.
 */

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { Chip, ConfirmDialog } from "@/components/ui";
import {
  formatCount,
  formatTime,
  groupByDay,
  MODE_META,
  type Photo,
  type PhotoMode,
  samplePhotos,
} from "./samplePhotos";
import {
  BackIcon,
  CameraIcon,
  CloseIcon,
  PanelFrame,
  PhotoFill,
  ShareIcon,
  ShareSheet,
  TrashIcon,
} from "./shared";

type Tab = "all" | PhotoMode;
const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "photo", label: "Photos" },
  { value: "burst", label: "Bursts" },
  { value: "4-frame", label: "4-Up" },
  { value: "gif", label: "GIFs" },
];

function ModeBadge({ mode }: { mode: PhotoMode }) {
  if (mode === "photo") return null;
  const m = MODE_META[mode];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.02em",
        color: "#fff",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(6px)",
      }}
    >
      <span style={{ color: m.tone }}>{m.glyph}</span>
      {m.label}
    </span>
  );
}

export function GalleryDesign01({ photos = samplePhotos }: { photos?: Photo[] }) {
  const [tab, setTab] = useState<Tab>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [deleted, setDeleted] = useState<Set<string>>(new Set());

  const live = useMemo(
    () => photos.filter((p) => !deleted.has(p.id) && (tab === "all" || p.mode === tab)),
    [photos, tab, deleted],
  );
  const days = useMemo(() => groupByDay(live), [live]);
  const open = live.find((p) => p.id === openId) ?? null;

  return (
    <PanelFrame>
      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "22px 28px 14px",
          flexShrink: 0,
        }}
      >
        <button type="button" style={roundBtn} aria-label="Back to camera">
          <BackIcon />
        </button>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" }}>
            Photo Booth
          </h1>
          <div className="cap" style={{ marginTop: 2 }}>
            {formatCount(live)} · {days.length} days
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {TABS.map((t) => (
            <Chip key={t.value} active={tab === t.value} onClick={() => setTab(t.value)}>
              {t.label}
            </Chip>
          ))}
        </div>
      </header>

      {/* Body */}
      <div
        style={{ flex: 1, overflowY: "auto", padding: "8px 28px 28px" }}
        className="modal-scroll"
      >
        {live.length === 0 ? (
          <EmptyState />
        ) : (
          days.map((day) => (
            <section key={day.key} style={{ marginBottom: 28 }}>
              <div
                style={{
                  position: "sticky",
                  top: 0,
                  display: "flex",
                  alignItems: "baseline",
                  gap: 10,
                  padding: "10px 0",
                  background: "linear-gradient(180deg, var(--bg) 60%, rgba(0,0,0,0))",
                  zIndex: 1,
                }}
              >
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{day.label}</h2>
                <span className="cap">{formatCount(day.photos)}</span>
              </div>
              <div style={{ columns: 4, columnGap: 14 }}>
                {day.photos.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setOpenId(p.id)}
                    style={{
                      display: "block",
                      width: "100%",
                      breakInside: "avoid",
                      marginBottom: 14,
                      padding: 0,
                      border: "1px solid var(--hair)",
                      borderRadius: 16,
                      overflow: "hidden",
                      background: "var(--nest)",
                      cursor: "pointer",
                      position: "relative",
                    }}
                  >
                    <div style={{ aspectRatio: aspectRatio(p), position: "relative" }}>
                      <PhotoFill photo={p} />
                      <div style={{ position: "absolute", top: 8, left: 8 }}>
                        <ModeBadge mode={p.mode} />
                      </div>
                      <span style={stampStyle}>{formatTime(p.capturedAt)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      {/* Lightbox */}
      {open && (
        <div style={lightboxWrap}>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpenId(null)}
            style={{ position: "absolute", inset: 0, border: "none", background: "transparent" }}
          />
          <div style={lightboxPanel}>
            <div style={{ position: "relative", flex: 1, minHeight: 0, background: "#000" }}>
              <PhotoFill photo={open} style={{ objectFit: "contain" }} />
            </div>
            <div style={lightboxBar}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>
                  {open.caption ?? MODE_META[open.mode].label}
                </div>
                <div className="cap" style={{ marginTop: 3 }}>
                  {formatTime(open.capturedAt)} · {open.filter}
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

function EmptyState() {
  return (
    <div
      style={{
        height: "100%",
        minHeight: 640,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 20,
      }}
    >
      <div
        style={{
          width: 108,
          height: 108,
          borderRadius: 28,
          border: "1px solid var(--hair)",
          background: "var(--nest)",
          display: "grid",
          placeItems: "center",
          color: "var(--ink-3)",
        }}
      >
        <CameraIcon size={46} strokeWidth={1.6} />
      </div>
      <div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>No photos yet</h2>
        <p style={{ margin: "8px 0 0", color: "var(--ink-2)", fontSize: 15, maxWidth: 360 }}>
          Shots you take in the booth show up here, grouped by day. Strike a pose to get started.
        </p>
      </div>
      <button type="button" style={ctaBtn}>
        <CameraIcon size={20} />
        Open camera
      </button>
    </div>
  );
}

function aspectRatio(p: Photo): string {
  if (p.mode === "4-frame") return "1 / 1";
  if (p.aspect === "portrait") return "3 / 4";
  if (p.aspect === "landscape") return "16 / 10";
  return "1 / 1";
}

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

const ctaBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
  height: 48,
  padding: "0 22px",
  borderRadius: 14,
  border: "1px solid var(--acc-line)",
  background: "var(--acc-dim)",
  color: "var(--acc)",
  fontFamily: "var(--ui)",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};

const stampStyle: CSSProperties = {
  position: "absolute",
  bottom: 8,
  right: 10,
  fontFamily: "var(--mono)",
  fontSize: 11,
  color: "rgba(255,255,255,0.9)",
  textShadow: "0 1px 4px #000",
};

const lightboxWrap: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 60,
  background: "rgba(0,0,0,0.82)",
  backdropFilter: "blur(8px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const lightboxPanel: CSSProperties = {
  position: "relative",
  width: 900,
  height: 820,
  display: "flex",
  flexDirection: "column",
  borderRadius: 20,
  overflow: "hidden",
  border: "1px solid var(--hair-2)",
  background: "var(--tile)",
  boxShadow: "0 40px 120px -30px rgba(0,0,0,0.9)",
};

const lightboxBar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "16px 20px",
  background: "var(--tile)",
  borderTop: "1px solid var(--hair)",
};
