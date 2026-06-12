/**
 * QuickPlayTileView - presentational component for the Quick-Play 4×2 tile
 * (www-51hf.23 / A28).
 *
 * Renders a horizontal artwork rail sourced from real Sonos Favorites + Spotify.
 * The currently-playing item gets an accent play badge. Tapping a cover plays it.
 * Skeleton shimmer while pending/error (A18).
 *
 * Pure presentational - no tRPC. The container (QuickPlayTile) wires mutations.
 */

import { Skeleton, Tile, TileHeader } from "@/components/ui";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QuickPlayItem {
  id: string;
  title: string;
  albumArtUri: string | null;
  source: "sonos" | "spotify";
  /** URI used to play the item (Sonos URI or Spotify context URI). */
  uri?: string;
}

export interface QuickPlayTileViewProps {
  status: "loading" | "error" | "populated";
  items: QuickPlayItem[];
  /** ID of the currently-playing item, or null if nothing playing. */
  playingItemId: string | null;
  onPlayItem: (item: QuickPlayItem) => void;
  onOpenFavorites: () => void;
  onOpenSpotify: () => void;
}

// ── Rail item ─────────────────────────────────────────────────────────────────

// Artwork edge in the tile's fixed 4×2 board slot (rail 130.4 − label 13.5 −
// gaps/padding 8). The art is square via aspect-ratio and flexes to the rail
// height, but a row-flex item's intrinsic width can't see that derived width,
// so the column must be pinned or it collapses to min-content.
const RAIL_ITEM_W = 109;

interface RailItemProps {
  item: QuickPlayItem;
  isPlaying: boolean;
  onClick: () => void;
}

function RailItem({ item, isPlaying, onClick }: RailItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flexShrink: 0,
        width: RAIL_ITEM_W,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: 0,
      }}
    >
      {/* Artwork - square via aspect-ratio, flexes to fill the rail height so
          the item's width follows from however tall the tile slot is. */}
      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          aspectRatio: "1 / 1",
          borderRadius: 8,
          background: item.albumArtUri ? "transparent" : "var(--tile-2)",
          overflow: "hidden",
          border: isPlaying ? "2px solid var(--accent)" : "2px solid transparent",
        }}
      >
        {item.albumArtUri ? (
          <img
            src={item.albumArtUri}
            alt={item.title}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ fontSize: 22, fontWeight: 700, color: "var(--ink-3)" }}>
              {item.title[0]}
            </span>
          </div>
        )}

        {/* Playing badge */}
        {isPlaying && (
          <div
            data-playing
            style={{
              position: "absolute",
              bottom: 3,
              right: 3,
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: "var(--accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="8" height="8" viewBox="0 0 24 24" fill="white" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        )}
      </div>

      {/* Title - width:0 + minWidth:100% keeps the nowrap text from inflating
          the button's intrinsic width, so the artwork alone sets item width. */}
      <span
        style={{
          fontSize: 9,
          color: isPlaying ? "var(--accent)" : "var(--ink-2)",
          textAlign: "center",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          width: 0,
          minWidth: "100%",
        }}
      >
        {item.title}
      </span>
    </button>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function QuickPlayTileView({
  status,
  items,
  playingItemId,
  onPlayItem,
  onOpenFavorites,
  onOpenSpotify,
}: QuickPlayTileViewProps) {
  const headerButtons = (
    <div style={{ display: "flex", gap: 6 }}>
      <button
        type="button"
        aria-label="Favorites"
        onClick={onOpenFavorites}
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
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
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Spotify"
        onClick={onOpenSpotify}
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
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
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.25 14.42c-.17.28-.54.37-.82.2-2.24-1.37-5.06-1.68-8.38-.92-.33.07-.65-.13-.72-.46-.08-.33.13-.65.46-.72 3.64-.83 6.76-.47 9.26 1.07.28.17.37.54.2.83zm1.13-2.5c-.21.35-.65.46-1 .25-2.56-1.57-6.46-2.02-9.48-1.11-.4.12-.82-.11-.94-.51s.11-.82.51-.94c3.46-1.05 7.76-.54 10.66 1.28.36.22.47.65.25 1.03zm.1-2.6c-3.07-1.82-8.13-1.99-11.06-1.1-.47.14-.96-.12-1.1-.59s.12-.96.59-1.1c3.36-1.02 8.95-.82 12.48 1.27.42.25.56.78.31 1.2-.25.41-.78.55-1.22.32z" />
        </svg>
      </button>
    </div>
  );

  if (status !== "populated") {
    return (
      <Tile padding={18} style={{ gap: 10 }}>
        <TileHeader icon="globe" title="Quick Play" right={headerButtons} />
        <Skeleton w="100%" h={70} />
      </Tile>
    );
  }

  return (
    <Tile padding={18} style={{ gap: 8 }}>
      <TileHeader icon="globe" title="Quick Play" right={headerButtons} />

      {/* Horizontal rail */}
      {items.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>No favorites</span>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            gap: 8,
            overflowX: "auto",
            flex: 1,
            minHeight: 0,
            alignItems: "stretch",
            paddingBottom: 4,
            scrollbarWidth: "none",
          }}
        >
          {items.map((item) => (
            <RailItem
              key={item.id}
              item={item}
              isPlaying={item.id === playingItemId}
              onClick={() => onPlayItem(item)}
            />
          ))}
        </div>
      )}
    </Tile>
  );
}
