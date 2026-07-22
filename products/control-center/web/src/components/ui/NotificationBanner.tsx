import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { openTileDetail } from "../../lib/tile-detail-store";

/** The tile whose detail page IS the Notification Center. */
const NOTIFICATION_CENTER_TILE = "tile_notif";

type NotificationTone = "red" | "amber" | "green";

/** Tone → the three colors a banner needs. One red, so the five banners match. */
const TONES: Record<NotificationTone, { fg: string; bg: string; border: string }> = {
  red: {
    fg: "var(--red, #e5484d)",
    bg: "rgba(229, 72, 77, 0.12)",
    border: "rgba(229, 72, 77, 0.4)",
  },
  amber: {
    fg: "var(--amber)",
    bg: "rgba(244, 192, 99, 0.1)",
    border: "rgba(244, 192, 99, 0.35)",
  },
  green: {
    fg: "var(--green, #7ac48f)",
    bg: "rgba(122, 196, 143, 0.1)",
    border: "rgba(122, 196, 143, 0.35)",
  },
};

interface NotificationBannerProps {
  tone: NotificationTone;
  /**
   * ARIA live semantics. The one-time setup nag and hard faults use
   * "alert"/assertive so a screen reader interrupts; the rest use
   * "status"/polite. Defaults to the polite pair.
   */
  role?: "status" | "alert";
  ariaLive?: "polite" | "assertive";
  children: ReactNode;
}

/**
 * One top-right notification banner (dot + message).
 *
 * Carries NO positioning: it flows inside NotificationBannerStack, which packs
 * whichever banners are live tight against the top-right corner. Each banner
 * used to hard-code its own `top` slot (18/62/106/150/194) on the assumption
 * that the higher-priority banners above it were also present; when they were
 * not, the visible banner floated down and left an empty gap above it. Flowing
 * in a column removes that gap entirely.
 *
 * The tap is the ONLY behavior here and it is deliberately uniform: every
 * banner opens the Notification Center (`tile_notif`) and does nothing else.
 * Centralizing it here means no banner can fall through to the tile behind it
 * (the old `pointerEvents: "none"` bug) or wire up some other action.
 */
export function NotificationBanner({
  tone,
  role = "status",
  ariaLive = "polite",
  children,
}: NotificationBannerProps) {
  const c = TONES[tone];
  const open = () => openTileDetail(NOTIFICATION_CENTER_TILE);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: must stay an aria-live region (status/alert) so the banner is announced, which a button role cannot carry; tabindex + the keydown handler give it button-equivalent activation on the wall panel.
    <div
      role={role}
      aria-live={ariaLive}
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px",
        borderRadius: 12,
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.fg,
        fontSize: 13,
        fontFamily: "var(--ui)",
        letterSpacing: "-0.01em",
        // The stack sets pointerEvents:none so its empty gaps fall through to the
        // board; each banner re-enables them so its own rect stays tappable.
        pointerEvents: "auto",
        cursor: "pointer",
        backdropFilter: "blur(6px)",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: c.fg,
          opacity: 0.85,
          flexShrink: 0,
        }}
      />
      <span>{children}</span>
    </div>
  );
}

/**
 * The top-right column the banners flow into. Fixed to the corner, packs its
 * children top-down with a small gap, and is itself pointer-transparent so only
 * the banner rectangles (which opt back in) catch taps.
 *
 * Portaled to <body> (the VariantSwitcher precedent): rendered in-tree the
 * stack lives under #stage's own stacking context, where NO zIndex can beat
 * the body-level detail-page/modal overlays (zIndex 100) , a ringing
 * alarm/timer banner (TimeSuiteBanner) and its Stop button would be invisible
 * whenever any detail page is open. Same body context ⇒ 120 > 100 keeps every
 * banner on top of open pages; the LayoutEditor overlay (1000) still covers it.
 */
export function NotificationBannerStack({ children }: { children: ReactNode }) {
  return createPortal(
    <div
      style={{
        position: "fixed",
        top: 18,
        right: 18,
        zIndex: 120,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 8,
        pointerEvents: "none",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
