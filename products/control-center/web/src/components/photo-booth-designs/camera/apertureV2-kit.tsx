/**
 * apertureV2-kit , shared chrome atoms for the four Aperture V2 camera
 * variations. Everything common across A–D , the top-bar close + flash
 * buttons, the app-standard gallery button, a filter swatch, and the
 * translucent menu surface , lives here so the variations differ only in how
 * they present the *timer control* and the *filter menu*, not in re-implemented
 * buttons.
 *
 * These lean on the house theme tokens (`--nest`, `--hair`, `--ink`, `--acc`,
 * `--amber`, `--r`, `--ui`, `--mono`) rather than bespoke colours, so the camera
 * chrome reads as native app UI. Where a control sits directly over the live
 * photo it uses a translucent dark fill + blur (iOS-camera style) so it stays
 * legible against any frame while still speaking the app's visual language.
 */

import { Images, X, Zap, ZapOff } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { CAMERA_FILTERS, type CameraFilter } from "./camera-shared";

/** Look up a filter by id, falling back to Original. */
export function filterById(id: string): CameraFilter {
  return CAMERA_FILTERS.find((f) => f.id === id) ?? CAMERA_FILTERS[0];
}

/**
 * Round 48px glass control button shared by the close + flash buttons (and any
 * timer treatment that wants the same affordance). Active brightens to the
 * house accent; `amber` opts into the flash-armed amber tint instead.
 */
export function glassBtn(active = false, amber = false): CSSProperties {
  const onBg = amber ? "var(--amber)" : "var(--acc)";
  const onInk = amber ? "#1a1206" : "var(--bg)";
  return {
    height: 48,
    width: 48,
    borderRadius: "50%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid var(--hair-2)",
    cursor: "pointer",
    background: active ? onBg : "rgba(10,10,10,0.5)",
    color: active ? onInk : "var(--ink)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    fontFamily: "var(--ui)",
  };
}

/** Translucent dark surface for menus (sheet / popover / strip), token-styled. */
export function glassPanel(): CSSProperties {
  return {
    background: "rgba(12,12,12,0.82)",
    border: "1px solid var(--hair-2)",
    borderRadius: "var(--r)",
    backdropFilter: "blur(18px) saturate(1.2)",
    WebkitBackdropFilter: "blur(18px) saturate(1.2)",
    boxShadow: "0 24px 64px -16px rgba(0,0,0,0.7)",
    color: "var(--ink)",
    fontFamily: "var(--ui)",
  };
}

/** Top-left close button, present on every variation. */
export function TopClose({ onClose }: { onClose?: () => void }) {
  return (
    <button type="button" style={glassBtn(false)} onClick={onClose} aria-label="Close camera">
      <X size={23} strokeWidth={2} />
    </button>
  );
}

/**
 * Flash toggle with an explicit off/on glyph (ZapOff ↔ Zap) so the state reads
 * without a label; armed state uses the amber "flash" tint.
 */
export function FlashButton({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      style={glassBtn(on, true)}
      onClick={onToggle}
      aria-label={on ? "Flash on" : "Flash off"}
      aria-pressed={on}
    >
      {on ? <Zap size={21} strokeWidth={2} /> : <ZapOff size={21} strokeWidth={2} />}
    </button>
  );
}

/**
 * Bottom-left gallery button, styled as a house control cell (rounded-rect,
 * hairline border, nested surface) rather than the ad-hoc gradient tile the
 * original Aperture used , this matches the app's ControlTap / tile language.
 */
export function GalleryButton({ onOpen }: { onOpen?: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open gallery"
      style={{
        width: 60,
        height: 60,
        borderRadius: 16,
        border: "1px solid var(--hair-2)",
        background: "rgba(10,10,10,0.5)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        color: "var(--ink)",
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
        boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.05)",
        transition: "border-color 0.15s ease",
      }}
    >
      <Images size={24} strokeWidth={1.8} />
    </button>
  );
}

/** Round filter swatch dot; ring brightens to the accent when active. */
export function Swatch({
  filter,
  active,
  size = 46,
}: {
  filter: CameraFilter;
  active: boolean;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: filter.swatch,
        flex: "0 0 auto",
        boxShadow: active
          ? "0 0 0 2px var(--bg), 0 0 0 4px var(--acc)"
          : "inset 0 0 0 1px var(--hair-2)",
        transition: "box-shadow 0.15s ease",
      }}
    />
  );
}

/** Top + bottom scrims so chrome stays legible over a bright frame. */
export function Scrim({ edge }: { edge: "top" | "bottom" }) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        height: 190,
        [edge]: 0,
        background:
          edge === "top"
            ? "linear-gradient(180deg, rgba(0,0,0,0.55), transparent)"
            : "linear-gradient(0deg, rgba(0,0,0,0.62), transparent)",
        pointerEvents: "none",
      }}
    />
  );
}

/** Full-bleed invisible backdrop that closes an open menu on outside tap. */
export function MenuScrim({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close menu"
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        border: "none",
        background: "transparent",
        cursor: "default",
        zIndex: 30,
      }}
    />
  );
}

/** Shared uppercase micro-label used on menu headers + triggers. */
export function menuCap(children: ReactNode) {
  return (
    <span
      style={{
        fontSize: 10.5,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: "var(--ink-3)",
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}
