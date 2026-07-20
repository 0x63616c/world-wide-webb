/**
 * shared , small building blocks reused across the ten Photo Booth gallery
 * design prototypes. Only genuinely-common, look-neutral pieces live here
 * (line icons, the photo pixel surface, an iOS share-sheet placeholder). Each
 * design still owns its own framing, spacing, and mood , the differences
 * between concepts must never be smuggled into a shared component.
 */

import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import { createPortal } from "react-dom";
import type { Photo } from "./samplePhotos";

// ---- line icons (stroke, currentColor) -------------------------------------

interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

function icon(path: ReactNode, size: number, color: string, sw: number) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

export function BackIcon({ size = 22, color = "currentColor", strokeWidth = 2 }: IconProps) {
  return icon(<path d="M15 5l-7 7 7 7" />, size, color, strokeWidth);
}

export function ShareIcon({ size = 22, color = "currentColor", strokeWidth = 2 }: IconProps) {
  return icon(
    <>
      <path d="M12 3v13" />
      <path d="M8 7l4-4 4 4" />
      <path d="M6 12H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-1" />
    </>,
    size,
    color,
    strokeWidth,
  );
}

export function TrashIcon({ size = 22, color = "currentColor", strokeWidth = 2 }: IconProps) {
  return icon(
    <>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
      <path d="M10 11v6M14 11v6" />
    </>,
    size,
    color,
    strokeWidth,
  );
}

export function CameraIcon({ size = 22, color = "currentColor", strokeWidth = 2 }: IconProps) {
  return icon(
    <>
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.2" />
    </>,
    size,
    color,
    strokeWidth,
  );
}

export function CloseIcon({ size = 22, color = "currentColor", strokeWidth = 2 }: IconProps) {
  return icon(<path d="M6 6l12 12M18 6L6 18" />, size, color, strokeWidth);
}

export function ChevronRight({ size = 22, color = "currentColor", strokeWidth = 2 }: IconProps) {
  return icon(<path d="M9 5l7 7-7 7" />, size, color, strokeWidth);
}

export function PlayIcon({ size = 22, color = "currentColor", strokeWidth = 2 }: IconProps) {
  return icon(<path d="M8 5l11 7-11 7z" />, size, color, strokeWidth);
}

// ---- photo surface ---------------------------------------------------------

/**
 * Renders the actual pixels of a photo: a single image, or , for a 4-frame
 * capture , the 2x2 grid-of-four inside one item, split by thin black gutters
 * like a printed booth strip. Callers own the outer frame (radius, border).
 */
export function PhotoFill({
  photo,
  style,
  gutter = 3,
}: {
  photo: Photo;
  style?: CSSProperties;
  gutter?: number;
}) {
  if (photo.mode === "4-frame") {
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: gutter,
          background: "#000",
          width: "100%",
          height: "100%",
          ...style,
        }}
      >
        {photo.frames.map((f, i) => (
          <img
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed 4-frame strip, order is stable and identity-free.
            key={i}
            src={f}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ))}
      </div>
    );
  }
  return (
    <img
      src={photo.frames[0]}
      alt=""
      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", ...style }}
    />
  );
}

// ---- iOS share-sheet placeholder -------------------------------------------

const SHARE_TARGETS = [
  { name: "AirDrop", glyph: "\u{1F4E1}", tint: "#0a84ff" },
  { name: "Messages", glyph: "\u{1F4AC}", tint: "#34c759" },
  { name: "Mail", glyph: "✉️", tint: "#0a84ff" },
  { name: "Notes", glyph: "\u{1F4DD}", tint: "#ffd60a" },
  { name: "Save", glyph: "⬇️", tint: "#8e8e93" },
  { name: "Copy", glyph: "\u{1F517}", tint: "#8e8e93" },
];

/**
 * A visual stand-in for the iOS system share sheet. Purely presentational , it
 * triggers nothing, it only shows the affordance a real build would hand off
 * to. Portalled to <body> so it floats above whichever design invoked it.
 */
export function ShareSheet({
  open,
  count = 1,
  onClose,
}: {
  open: boolean;
  count?: number;
  onClose: () => void;
}) {
  if (!open) return null;
  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background: "rgba(0,0,0,0.5)",
      }}
    >
      <button
        type="button"
        aria-label="Dismiss share sheet"
        onClick={onClose}
        style={{ position: "absolute", inset: 0, border: "none", background: "transparent" }}
      />
      <div
        style={{
          position: "relative",
          width: 460,
          margin: 20,
          padding: "18px 18px 12px",
          borderRadius: 26,
          background: "rgba(30,30,32,0.86)",
          backdropFilter: "blur(30px)",
          WebkitBackdropFilter: "blur(30px)",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 30px 80px -20px rgba(0,0,0,0.8)",
          fontFamily: "var(--ui)",
          color: "#fff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: "linear-gradient(135deg,#ff8a5c,#ff3d81)",
              display: "grid",
              placeItems: "center",
              fontSize: 22,
            }}
          >
            {"\u{1F4F8}"}
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>
              {count === 1 ? "1 Photo" : `${count} Photos`}
            </div>
            <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.55)" }}>Photo Booth</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, overflow: "hidden", paddingBottom: 6 }}>
          {SHARE_TARGETS.map((t) => (
            <div key={t.name} style={{ textAlign: "center", flex: "0 0 auto", width: 60 }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  background: t.tint,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 26,
                  margin: "0 auto 6px",
                }}
              >
                {t.glyph}
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)" }}>{t.name}</div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            width: "100%",
            marginTop: 14,
            height: 48,
            borderRadius: 14,
            border: "none",
            background: "rgba(255,255,255,0.1)",
            color: "#fff",
            fontFamily: "var(--ui)",
            fontSize: 16,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  );
}

// ---- design frame ----------------------------------------------------------

/**
 * The fixed 1366x1024 wall-panel stage every gallery story renders inside.
 * Applies the shared font/ink so tokens resolve, and clips to the panel bounds
 * (the real board never scrolls the page).
 */
export function PanelFrame({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      className="e-root"
      style={{
        width: 1366,
        height: 1024,
        overflow: "hidden",
        position: "relative",
        background: "var(--bg)",
        color: "var(--ink)",
        fontFamily: "var(--ui)",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Tiny helper for the ubiquitous "N selected" plural. */
export function useSelection() {
  const [selected, setSelected] = useState<string | null>(null);
  return { selected, setSelected };
}
