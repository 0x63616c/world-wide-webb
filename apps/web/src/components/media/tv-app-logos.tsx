/**
 * tv-app-logos — brand-mark lookup for Apple TV apps (CC-0z4f).
 *
 * The design renders each app as its real, full-color brand mark (YouTube play
 * box, Netflix "N", Prime/Hulu/Disney+ wordmarks, …) rather than a grey letter
 * avatar. App names arrive verbatim from Home Assistant's `source_list`, so we
 * normalise the name and look up a hand-built mark; anything we don't have a
 * mark for falls back to a tasteful 2-letter monospace glyph (NOT fake data —
 * a deterministic typographic stand-in derived from the real app name).
 *
 * Shared by TvAppsTileView (tile) and AllAppsModal so both stay consistent.
 */

import type { ReactNode } from "react";

// ── Brand registry ──────────────────────────────────────────────────────────

interface Brand {
  /** Background fill for the logo plate (brand-accurate where it reads better). */
  bg: string;
  /** Renders the mark at the given square size. */
  render: (size: number) => ReactNode;
}

/** Lowercased, alphanumeric-only key so "Disney+", "Prime Video" etc. resolve. */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** A centered colored wordmark (used for text-style brand marks). */
function wordmark(text: string, color: string, size: number, italic = false): ReactNode {
  return (
    <span
      style={{
        fontFamily: "var(--ui)",
        fontWeight: 800,
        fontSize: size * 0.34,
        lineHeight: 1,
        letterSpacing: "-0.03em",
        color,
        fontStyle: italic ? "italic" : "normal",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

// Aliases map the various source_list spellings onto one brand key.
const ALIASES: Record<string, string> = {
  primevideo: "prime",
  amazonprimevideo: "prime",
  appletv: "appletv",
  appletvplus: "appletv",
  tv: "appletv",
  disneyplus: "disney",
  hbomax: "max",
  spotifymusic: "spotify",
};

const BRANDS: Record<string, Brand> = {
  youtube: {
    bg: "#0a0a0a",
    render: (s) => (
      <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#FF0000"
          d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.872.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12z"
        />
      </svg>
    ),
  },
  netflix: {
    bg: "#0a0a0a",
    render: (s) => (
      <svg width={s * 0.62} height={s} viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#E50914"
          d="M5.398 0v.006c3.028 8.556 5.37 15.175 8.348 23.596 2.344.058 4.85.398 4.854.398-2.8-7.924-5.923-16.747-8.487-24zm8.489 0v9.63L18.6 22.951c-.043-7.86-.004-15.913.002-22.95zM5.398 1.05V24c1.873-.225 2.81-.312 4.715-.398v-9.22z"
        />
      </svg>
    ),
  },
  prime: {
    bg: "#0a0a0a",
    render: (s) => (
      <span
        style={{
          display: "inline-flex",
          flexDirection: "column",
          alignItems: "center",
          gap: s * 0.04,
        }}
      >
        {wordmark("prime", "#ffffff", s * 1.18)}
        <svg width={s * 0.5} height={s * 0.14} viewBox="0 0 40 11" aria-hidden="true">
          <path
            d="M2 3c8 6 28 6 36 0"
            fill="none"
            stroke="#00A8E1"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path d="M33 1l5 2-3 4z" fill="#00A8E1" />
        </svg>
      </span>
    ),
  },
  disney: {
    bg: "#0a0a0a",
    render: (s) => (
      <span style={{ display: "inline-flex", alignItems: "baseline", gap: s * 0.02 }}>
        {wordmark("Disney", "#1f8bf4", s * 1.05, true)}
        <span
          style={{
            fontFamily: "var(--ui)",
            fontWeight: 700,
            fontSize: s * 0.26,
            color: "#1f8bf4",
            verticalAlign: "super",
          }}
        >
          +
        </span>
      </span>
    ),
  },
  hulu: {
    bg: "#0a0a0a",
    render: (s) => wordmark("hulu", "#1CE783", s * 1.25),
  },
  appletv: {
    bg: "#0a0a0a",
    render: (s) => (
      <span style={{ display: "inline-flex", alignItems: "center", gap: s * 0.04 }}>
        <svg width={s * 0.42} height={s * 0.5} viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#ffffff"
            d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701z"
          />
        </svg>
        {wordmark("tv", "#ffffff", s * 0.92)}
      </span>
    ),
  },
  spotify: {
    bg: "#0a0a0a",
    render: (s) => (
      <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#1DB954"
          d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141 4.32-1.32 9.72-.66 13.44 1.62.361.181.54.78.301 1.201zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.56.3z"
        />
      </svg>
    ),
  },
  max: {
    bg: "#0a0a0a",
    render: (s) => wordmark("max", "#0046ff", s * 1.2),
  },
  paramount: {
    bg: "#0a0a0a",
    render: (s) => wordmark("P+", "#0064ff", s * 1.1),
  },
  peacock: {
    bg: "#0a0a0a",
    render: (s) => wordmark("peacock", "#ffffff", s * 0.95),
  },
};

// ── Public API ────────────────────────────────────────────────────────────────

function resolveKey(name: string): string {
  const key = normalize(name);
  return ALIASES[key] ?? key;
}

/** True if the app resolves to a registered full-color brand mark (not the glyph). */
function hasBrandMark(name: string): boolean {
  return resolveKey(name) in BRANDS;
}

/**
 * Curated favorites, in display order. Chosen because each has a real brand mark
 * and is a likely "what's open" hero. Matched against the live HA source_list by
 * normalized key, so spelling variants ("Apple TV" / "Apple TV+", "HBO Max" /
 * "Max") still resolve. An app only ever appears if it's actually installed.
 */
const FAVORITE_APPS = [
  "YouTube",
  "Netflix",
  "Prime Video",
  "Disney+",
  "Hulu",
  "Apple TV+",
  "Spotify",
  "Max",
] as const;

const FAVORITE_RANK = new Map(FAVORITE_APPS.map((name, i) => [resolveKey(name), i]));

/**
 * Orders the live source_list for display: curated favorites first (in
 * FAVORITE_APPS order), then the remaining apps with branded-logo ones before
 * glyph-only fallbacks (each group keeps source_list order). Returns the REAL
 * source_list strings so they stay launchable. Drives BOTH the tile's 2×2 grid
 * and the AllAppsModal browse list, so the two never disagree.
 */
export function tvAppsInOrder(sourceList: string[]): string[] {
  const rankOf = (a: string) => FAVORITE_RANK.get(resolveKey(a));
  const favorites = sourceList
    .filter((a) => rankOf(a) !== undefined)
    .sort((a, b) => (rankOf(a) ?? 0) - (rankOf(b) ?? 0));
  const rest = sourceList.filter((a) => rankOf(a) === undefined);
  const branded = rest.filter(hasBrandMark);
  const glyphOnly = rest.filter((a) => !hasBrandMark(a));
  return [...favorites, ...branded, ...glyphOnly];
}

/** Derives a deterministic 2-letter monospace glyph from a real app name. */
function fallbackGlyph(name: string): string {
  const words = name
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0] ?? name;
  return (w.slice(0, 2) || "??").toUpperCase();
}

interface TvAppMarkProps {
  name: string;
  /** Square edge the mark is sized to fit within, in px. */
  size: number;
}

/**
 * Renders ONLY the brand mark (no plate) sized to fit `size`. Use this when the
 * surrounding cell already provides the rounded plate (e.g. the grid cells).
 * Falls back to a 2-letter monospace glyph for apps without a registered mark.
 */
export function TvAppMark({ name, size }: TvAppMarkProps) {
  const brand = BRANDS[resolveKey(name)];
  if (brand) return <>{brand.render(size)}</>;
  return (
    <span
      style={{
        fontFamily: "var(--mono)",
        fontWeight: 700,
        fontSize: size * 0.6,
        letterSpacing: "0.02em",
        color: "var(--ink-2)",
      }}
    >
      {fallbackGlyph(name)}
    </span>
  );
}

interface TvAppLogoProps {
  name: string;
  /** Square edge of the logo plate in px. */
  size: number;
  /** Plate corner radius (defaults proportional to size). */
  radius?: number;
}

/**
 * Renders an app's brand mark on a standalone rounded plate (hero cell, modal
 * grid). Wraps {@link TvAppMark}.
 */
export function TvAppLogo({ name, size, radius }: TvAppLogoProps) {
  const brand = BRANDS[resolveKey(name)];
  const r = radius ?? Math.round(size * 0.26);

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: r,
        background: brand ? brand.bg : "var(--nest)",
        border: "1px solid var(--hair)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      <TvAppMark name={name} size={size * 0.56} />
    </div>
  );
}
