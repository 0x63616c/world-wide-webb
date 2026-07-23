/**
 * FavoritesModal , the Quick Play detail page's "Favorites" variant
 * (www-51hf.24 / A29).
 *
 * Renders real Sonos Favorites from the sonosFavorites query. A target/zone chip
 * row lets the user choose which room to play to. Tapping a cover plays it to
 * the selected zone via a Sonos transport mutation. The playing item is badged.
 *
 * Bare page body (no <Modal>) , hosted by TileDetailHost, which supplies the
 * page shell and header; live data comes from detail/wiring/quickplay.tsx.
 */

import { useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SonosFavorite {
  title: string;
  uri: string;
  albumArtUri: string | null;
}

export interface FavoritesModalProps {
  favorites: SonosFavorite[];
  zones: string[];
  /** Called with the chosen favorite and the target zone name. */
  onPlay: (favorite: SonosFavorite, zone: string) => void;
  /** URI of the currently-playing item (to show playing badge). */
  playingUri?: string | null;
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function FavoritesModal({ favorites, zones, onPlay, playingUri }: FavoritesModalProps) {
  const [selectedZone, setSelectedZone] = useState<string>(zones[0] ?? "");

  return (
    <div style={{ maxWidth: 920, margin: "0 auto" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Zone picker chips */}
        <div>
          <div style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 6 }}>PLAY TO</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {zones.map((zone) => (
              <button
                key={zone}
                type="button"
                onClick={() => setSelectedZone(zone)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 20,
                  border: "1px solid var(--tile-3)",
                  background: zone === selectedZone ? "var(--accent)" : "transparent",
                  color: zone === selectedZone ? "#fff" : "var(--ink-2)",
                  fontSize: 12,
                  cursor: "pointer",
                  fontWeight: zone === selectedZone ? 600 : 500,
                }}
              >
                {zone}
              </button>
            ))}
          </div>
        </div>

        {/* Favorites grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 10,
          }}
        >
          {favorites.map((fav) => {
            const isPlaying = playingUri != null && fav.uri === playingUri;
            return (
              <button
                key={fav.uri}
                type="button"
                onClick={() => {
                  onPlay(fav, selectedZone);
                }}
                style={{
                  padding: 10,
                  borderRadius: 12,
                  border: isPlaying ? "2px solid var(--accent)" : "2px solid transparent",
                  background: "var(--tile-2)",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  position: "relative",
                }}
              >
                {/* Artwork */}
                <div
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 8,
                    background: fav.albumArtUri ? "transparent" : "var(--tile-3)",
                    overflow: "hidden",
                    flexShrink: 0,
                  }}
                >
                  {fav.albumArtUri ? (
                    <img
                      src={fav.albumArtUri}
                      alt={fav.title}
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
                      <span style={{ fontSize: 28, fontWeight: 700, color: "var(--ink-3)" }}>
                        {fav.title[0]}
                      </span>
                    </div>
                  )}
                </div>

                {/* Title */}
                <span
                  style={{
                    fontSize: 11,
                    color: isPlaying ? "var(--accent)" : "var(--ink-2)",
                    textAlign: "center",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "100%",
                  }}
                >
                  {fav.title}
                </span>

                {/* Playing badge */}
                {isPlaying && (
                  <div
                    data-playing-badge
                    style={{
                      position: "absolute",
                      top: 6,
                      right: 6,
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
              </button>
            );
          })}
        </div>

        {favorites.length === 0 && (
          <div
            style={{
              textAlign: "center",
              color: "var(--ink-3)",
              fontSize: 13,
              padding: "20px 0",
            }}
          >
            No favorites saved
          </div>
        )}
      </div>
    </div>
  );
}
