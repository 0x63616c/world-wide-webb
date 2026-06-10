/**
 * TvAppsTileView — presentational component for the TV Apps 4×2 tile (CC-0z4f).
 *
 * Matches the approved design: a bento header glyph + a colored status pill
 * (active app name, or IDLE), a hero card showing the open app's full-color
 * brand logo + name + "OPEN · RESUME" (accent ring), and a 2×2 grid of brand
 * logos for the next apps (no text labels). Idle hero shows a TV glyph +
 * "Apple TV" + "NOTHING OPEN". Skeleton shimmer while pending/error (A18).
 *
 * The whole tile owns its tap (opens AllAppsModal); the hero/grid buttons
 * stopPropagation so they launch their app instead. Pure presentational — no
 * tRPC; the container (TvAppsTile) wires mutations.
 */

import { Skeleton, Tile, TileHeader } from "@/components/ui";
import { TvAppLogo, TvAppMark, tvAppsInOrder } from "./tv-app-logos";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TvAppsTileViewProps {
  status: "loading" | "error" | "populated";
  apps: string[];
  currentApp: string | null;
  onLaunchApp: (app: string) => void;
  onOpenAllApps: () => void;
}

// ── Status pill ─────────────────────────────────────────────────────────────

function StatusPill({ currentApp }: { currentApp: string | null }) {
  const active = currentApp !== null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 24,
        padding: "0 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        background: active ? "var(--acc-dim)" : "var(--tile-2)",
        border: `1px solid ${active ? "var(--acc-line)" : "var(--hair-2)"}`,
        color: active ? "var(--acc)" : "var(--ink-3)",
        maxWidth: 150,
        overflow: "hidden",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: active ? "var(--acc)" : "var(--ink-3)",
          flexShrink: 0,
        }}
      />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {active ? currentApp : "Idle"}
      </span>
    </span>
  );
}

// ── Grid cell (logo only, no label) ──────────────────────────────────────────

function GridCell({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={name}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        minWidth: 0,
        borderRadius: 12,
        border: "1px solid var(--hair)",
        background: "var(--tile-2)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
      }}
    >
      <TvAppMark name={name} size={38} />
    </button>
  );
}

// ── Idle hero glyph (TV / monitor) ───────────────────────────────────────────

function MonitorGlyph() {
  return (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: 10,
        background: "var(--nest)",
        border: "1px solid var(--hair)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <rect
          x="2.5"
          y="4.5"
          width="19"
          height="13"
          rx="2"
          fill="none"
          stroke="var(--ink-3)"
          strokeWidth="1.6"
        />
        <line
          x1="8"
          y1="20.5"
          x2="16"
          y2="20.5"
          stroke="var(--ink-3)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function TvAppsTileView({
  status,
  apps,
  currentApp,
  onLaunchApp,
  onOpenAllApps,
}: TvAppsTileViewProps) {
  if (status !== "populated") {
    return (
      <Tile padding={12} style={{ gap: 10 }}>
        <TileHeader icon="apps" title="TV Apps" />
        <Skeleton w="100%" h={120} />
      </Tile>
    );
  }

  // Hero = current app; grid = the curated order minus the current app, top 4.
  // Favorites-first ordering means a favorite-as-hero frees its slot and the
  // next favorite fills in; backfills from non-favorites when <4 are installed.
  const otherApps = tvAppsInOrder(apps)
    .filter((a) => a !== currentApp)
    .slice(0, 4);

  return (
    <Tile padding={12} style={{ gap: 0 }} onClick={onOpenAllApps}>
      <TileHeader icon="apps" title="TV Apps" right={<StatusPill currentApp={currentApp} />} />

      {/* Hero + 2×2 grid */}
      <div style={{ display: "flex", gap: 8, flex: 1, minHeight: 0 }}>
        {/* Hero cell */}
        <button
          type="button"
          aria-label={currentApp ? `${currentApp} — open` : "Nothing open"}
          onClick={(e) => {
            e.stopPropagation();
            if (currentApp) onLaunchApp(currentApp);
          }}
          style={{
            flex: "0 0 42%",
            minWidth: 0,
            borderRadius: 14,
            border: `1.5px solid ${currentApp ? "var(--acc-line)" : "var(--hair)"}`,
            background: currentApp ? "var(--acc-dim)" : "var(--tile-2)",
            cursor: currentApp ? "pointer" : "default",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            justifyContent: "space-between",
            padding: 12,
            textAlign: "left",
          }}
        >
          {currentApp ? <TvAppLogo name={currentApp} size={44} /> : <MonitorGlyph />}

          <div style={{ width: "100%", minWidth: 0 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "var(--ink)",
                letterSpacing: "-0.02em",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {currentApp ?? "Apple TV"}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginTop: 3,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: currentApp ? "var(--acc)" : "var(--ink-3)",
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: currentApp ? "var(--acc)" : "var(--ink-3)",
                }}
              />
              {currentApp ? "Open · Resume" : "Nothing open"}
            </div>
          </div>
        </button>

        {/* 2×2 grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gridTemplateRows: "1fr 1fr",
            gap: 8,
            flex: 1,
            minWidth: 0,
          }}
        >
          {otherApps.map((app) => (
            <GridCell key={app} name={app} onClick={() => onLaunchApp(app)} />
          ))}
        </div>
      </div>
    </Tile>
  );
}
