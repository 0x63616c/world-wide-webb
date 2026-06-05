/**
 * VariantSwitcher — floating segmented selector that sits ABOVE the open detail
 * modal and lets you swap between a tile's designed modal variants live.
 *
 * Rendered as a fixed, top-centred pill bar layered above the Modal overlay
 * (z-index above the Modal's 100). Only shown when a tile has >1 variant.
 */

import type { LiveVariant } from "./types";

export interface VariantSwitcherProps {
  variants: LiveVariant[];
  activeSlug: string;
  onSelect: (slug: string) => void;
}

export function VariantSwitcher({ variants, activeSlug, onSelect }: VariantSwitcherProps) {
  return (
    <div
      // Fixed top-centre, above the Modal (z 100). pointerEvents none on the
      // wrapper so it never blocks backdrop clicks outside the pill bar itself.
      style={{
        position: "fixed",
        top: 18,
        left: 0,
        right: 0,
        zIndex: 110,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        role="tablist"
        aria-label="Modal variant"
        style={{
          display: "flex",
          gap: 4,
          padding: 5,
          maxWidth: "92vw",
          overflowX: "auto",
          background: "var(--tile)",
          border: "1px solid var(--hair)",
          borderRadius: 999,
          boxShadow: "0 12px 32px -12px rgba(0,0,0,0.7)",
          pointerEvents: "auto",
        }}
      >
        {variants.map((v) => {
          const active = v.slug === activeSlug;
          return (
            <button
              key={v.slug}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(v.slug)}
              style={{
                whiteSpace: "nowrap",
                padding: "7px 14px",
                borderRadius: 999,
                border: "none",
                cursor: "pointer",
                font: "inherit",
                fontSize: 13,
                fontWeight: 500,
                color: active ? "#ffffff" : "var(--ink-2)",
                background: active ? "var(--acc)" : "transparent",
              }}
            >
              {v.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
