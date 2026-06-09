/**
 * TvAppsTileView — presentational component for the TV Apps 4×2 tile
 * (www-51hf.21 / A26).
 *
 * Renders a hero cell for the currently-open Apple TV app (or idle state),
 * plus a 2×2 grid of other top apps. The open app gets an accent ring.
 * Skeleton shimmer while pending/error (A18).
 *
 * Pure presentational — no tRPC. The container (TvAppsTile) wires mutations.
 */

import { Skeleton, Tile, TileHeader } from "@/components/ui";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TvAppsTileViewProps {
  status: "loading" | "error" | "populated";
  apps: string[];
  currentApp: string | null;
  onLaunchApp: (app: string) => void;
  onOpenAllApps: () => void;
}

// ── App cell ──────────────────────────────────────────────────────────────────

interface AppCellProps {
  name: string;
  isActive: boolean;
  isHero: boolean;
  onClick: () => void;
}

function AppCell({ name, isActive, isHero, onClick }: AppCellProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: isHero ? "0 0 auto" : 1,
        minWidth: 0,
        height: isHero ? 64 : 44,
        borderRadius: 10,
        border: isActive ? "2px solid var(--accent)" : "2px solid transparent",
        background: "var(--tile-2)",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "4px 6px",
        position: "relative",
        gap: 3,
      }}
    >
      {/* App initial as stand-in artwork */}
      <div
        style={{
          width: isHero ? 32 : 22,
          height: isHero ? 32 : 22,
          borderRadius: isHero ? 8 : 6,
          background: isActive ? "var(--accent)" : "var(--tile-3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: isHero ? 16 : 11,
            fontWeight: 700,
            color: isActive ? "#fff" : "var(--ink-2)",
          }}
        >
          {name[0]}
        </span>
      </div>
      <span
        style={{
          fontSize: 9,
          color: isActive ? "var(--accent)" : "var(--ink-2)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: "100%",
        }}
      >
        {name}
      </span>

      {/* Active dot */}
      {isActive && (
        <div
          data-active-dot
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--accent)",
          }}
        />
      )}
    </button>
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
        <TileHeader icon="cam" title="TV Apps" />
        <Skeleton w="100%" h={60} />
      </Tile>
    );
  }

  // Hero = current app; other apps = the next 4 in the list (not the current).
  const otherApps = apps.filter((a) => a !== currentApp).slice(0, 4);

  return (
    <Tile padding={10} style={{ gap: 6 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <TileHeader icon="cam" title="TV Apps" />
        <button
          type="button"
          aria-label="All apps"
          onClick={onOpenAllApps}
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            background: "var(--tile-2)",
            color: "var(--ink-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M4 8h4V4H4zm6 12h4v-4h-4zm-6 0h4v-4H4zm0-6h4v-4H4zm6 0h4v-4h-4zm6-10v4h4V4zm-6 4h4V4h-4zm6 6h4v-4h-4zm0 6h4v-4h-4z" />
          </svg>
        </button>
      </div>

      {/* Hero + 2x2 grid */}
      <div style={{ display: "flex", gap: 6, flex: 1 }}>
        {/* Hero cell */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          {currentApp ? (
            <AppCell name={currentApp} isActive isHero onClick={() => onLaunchApp(currentApp)} />
          ) : (
            <div
              style={{
                width: 72,
                height: 64,
                borderRadius: 10,
                background: "var(--tile-2)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
              }}
            >
              <span style={{ fontSize: 20 }}>📺</span>
              <span style={{ fontSize: 9, color: "var(--ink-3)" }}>Idle</span>
            </div>
          )}
        </div>

        {/* 2x2 grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gridTemplateRows: "1fr 1fr",
            gap: 4,
            flex: 1,
          }}
        >
          {otherApps.slice(0, 4).map((app) => (
            <AppCell
              key={app}
              name={app}
              isActive={false}
              isHero={false}
              onClick={() => onLaunchApp(app)}
            />
          ))}
        </div>
      </div>
    </Tile>
  );
}
