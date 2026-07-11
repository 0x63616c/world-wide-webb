/**
 * GroupsModalView , patch-bay presentational modal for Sonos groups (www-51hf).
 *
 * Two-column layout: Sources (the small set of things that can drive a group ,
 * hardware floor cards + live sessions, see deriveSources) on the left, the
 * real speaker/room list on the right. Tapping a speaker toggles whether it
 * follows the selected source; ALL fans the selected source out to every room.
 *
 * Pure presentational , no tRPC, no data hooks. All state (selection, group
 * membership) is driven by props; the container (Task 7) owns the mutations.
 */

import type { CSSProperties } from "react";
import { Modal } from "@/components/ui";
import type { GroupSource, SourceKind } from "./lib/derive-sources";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GroupsModalViewProps {
  open: boolean;
  onClose: () => void;
  sources: GroupSource[];
  /** room uuid -> source id | null (optimistic state from useGroupMembership). */
  member: Record<string, string | null>;
  /** Rooms to list in the speaker column, already in display order. */
  speakers: Array<{ uuid: string; name: string }>;
  selectedSourceId: string;
  onSelectSource: (sourceId: string) => void;
  /** Tap a speaker row: container decides join vs leave from `member`. */
  onTapSpeaker: (uuid: string) => void;
  /** ALL button on the selected source. */
  onAll: () => void;
  /** Latest join/leave/grab mutation error message, or null , rendered under the columns. */
  errorText?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Human label for a source's detail (what it's driving), used in the status
// line alongside the room name so a card never has to repeat "Living Room ·
// Living Room". Kept exhaustive over SourceKind so a new kind fails to compile
// here rather than rendering blank.
const KIND_LABEL: Record<SourceKind, string> = {
  "line-in": "Line-In",
  tv: "TV",
  spotify: "Spotify",
  airplay: "AirPlay",
  other: "Source",
  idle: "Idle",
};

function statusLine(source: GroupSource): string {
  const detail = KIND_LABEL[source.kind];
  return source.trackLine ? `${detail} · ${source.trackLine}` : detail;
}

// Deterministic per-source EQ stagger , same source id always produces the
// same phase/duration so cards don't visibly resync on re-render, but distinct
// sources read as visually out of phase with each other. djb2 string hash.
function hashId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = (h * 33 + id.charCodeAt(i)) >>> 0;
  }
  return h;
}

// ── EQ bars ───────────────────────────────────────────────────────────────────

interface EqBarsProps {
  sourceId: string;
}

function EqBars({ sourceId }: EqBarsProps) {
  const h = hashId(sourceId);
  const base = (h % 40) / 100; // 0..0.39s
  const dur = 0.85 + ((h >> 3) % 30) / 100; // 0.85..1.14s

  return (
    <div
      aria-hidden="true"
      style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 14, flexShrink: 0 }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="gm-eq-bar"
          style={
            {
              "--eq-dur": `${dur}s`,
              "--eq-delay": `${base + i * 0.18}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

// ── Source card ───────────────────────────────────────────────────────────────

interface SourceCardProps {
  source: GroupSource;
  selected: boolean;
  onSelect: () => void;
  onAll: () => void;
}

function SourceCard({ source, selected, onSelect, onAll }: SourceCardProps) {
  return (
    <div
      style={
        {
          "--sc": `var(${source.colorVar})`,
          position: "relative",
          overflow: "visible",
          borderRadius: 12,
          background: selected ? "color-mix(in srgb, var(--sc) 14%, transparent)" : "var(--tile-2)",
          border: selected
            ? "1px solid color-mix(in srgb, var(--sc) 45%, transparent)"
            : "1px solid var(--hair)",
        } as CSSProperties
      }
    >
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Select ${source.label}`}
        onClick={onSelect}
        style={{
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          padding: selected ? "10px 40px 26px 12px" : "10px 12px",
          font: "inherit",
          color: "inherit",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ink)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {source.roomName}
            </span>
            {source.isSession && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  color: "var(--sc)",
                  background: "var(--nest)",
                  borderRadius: 4,
                  padding: "2px 5px",
                  flexShrink: 0,
                }}
              >
                SESSION
              </span>
            )}
          </div>
          {source.playing && <EqBars sourceId={source.id} />}
        </div>
        <span
          style={{
            fontSize: 10,
            color: "var(--ink-3)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {statusLine(source)}
        </span>
      </button>

      {/* Jack dot , only the selected card shows a patch connector poking out
          the right edge, reading as "this is what's plugged in". Centered in
          the 20px column gutter (right: -15 puts the 10px dot at 5..15px past
          the card edge) so it never overlaps the speaker rows. */}
      {selected && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "50%",
            right: -15,
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "var(--sc)",
            boxShadow: "0 0 8px var(--sc)",
            transform: "translateY(-50%)",
          }}
        />
      )}

      {/* ALL , sibling to the select button (never nested inside it) so the
          card stays valid, non-nested interactive markup. */}
      {selected && (
        <button
          type="button"
          aria-label={`Send all speakers to ${source.label}`}
          onClick={onAll}
          style={{
            position: "absolute",
            right: 12,
            bottom: 10,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.04em",
            color: "var(--sc)",
            background: "color-mix(in srgb, var(--sc) 14%, transparent)",
            border: "none",
            borderRadius: 6,
            padding: "3px 8px",
            cursor: "pointer",
          }}
        >
          ALL
        </button>
      )}
    </div>
  );
}

// ── Speaker row ───────────────────────────────────────────────────────────────

interface SpeakerRowProps {
  uuid: string;
  name: string;
  followedSource: GroupSource | undefined;
  isAnchorOfSelected: boolean;
  onTap: () => void;
}

function SpeakerRow({ name, followedSource, isAnchorOfSelected, onTap }: SpeakerRowProps) {
  return (
    <button
      type="button"
      disabled={isAnchorOfSelected}
      aria-pressed={followedSource != null}
      aria-label={followedSource ? `${name}, following ${followedSource.roomName}` : `${name}, off`}
      onClick={onTap}
      style={
        {
          ...(followedSource ? { "--sc": `var(${followedSource.colorVar})` } : {}),
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderRadius: 12,
          background: "var(--tile-2)",
          border: "1px solid var(--hair)",
          padding: "10px 12px",
          font: "inherit",
          cursor: isAnchorOfSelected ? "default" : "pointer",
          opacity: isAnchorOfSelected ? 0.7 : 1,
        } as CSSProperties
      }
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          flexShrink: 0,
          background: followedSource ? "var(--sc)" : "var(--nest)",
          border: followedSource ? "1px solid var(--sc)" : "1px solid var(--hair-2)",
          boxShadow: followedSource ? "0 0 6px var(--sc)" : "none",
        }}
      />
      <span
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: "var(--ink)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {name}
      </span>
      <span
        style={{
          marginLeft: "auto",
          fontSize: 10,
          color: "var(--ink-3)",
          flexShrink: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {followedSource ? followedSource.roomName : "off"}
      </span>
    </button>
  );
}

// ── Column label ──────────────────────────────────────────────────────────────

function ColumnLabel({ children }: { children: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--ink-3)",
      }}
    >
      {children}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function GroupsModalView({
  open,
  onClose,
  sources,
  member,
  speakers,
  selectedSourceId,
  onSelectSource,
  onTapSpeaker,
  onAll,
  errorText,
}: GroupsModalViewProps) {
  const selectedSource = sources.find((s) => s.id === selectedSourceId);

  return (
    <Modal open={open} onClose={onClose} title="Groups" width={640} maxHeight={760}>
      <style>{`
        @keyframes gmEq {
          0%, 100% { height: 4px; }
          50% { height: 14px; }
        }
        .gm-eq-bar {
          width: 3px;
          height: 4px;
          border-radius: 1px;
          background: var(--sc);
          animation: gmEq var(--eq-dur, 1s) ease-in-out infinite;
          animation-delay: var(--eq-delay, 0s);
        }
        @media (prefers-reduced-motion: reduce) {
          .gm-eq-bar {
            animation: none;
            height: 8px;
          }
        }
      `}</style>

      <div style={{ display: "flex", gap: 20 }}>
        {/* Sources column */}
        <div style={{ flex: 1.25, display: "flex", flexDirection: "column", gap: 10 }}>
          <ColumnLabel>Sources</ColumnLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {sources.map((source) => (
              <SourceCard
                key={source.id}
                source={source}
                selected={source.id === selectedSourceId}
                onSelect={() => onSelectSource(source.id)}
                onAll={onAll}
              />
            ))}
          </div>
        </div>

        {/* Speakers column */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
          <ColumnLabel>Speakers</ColumnLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {speakers.map((sp) => {
              const followedId = member[sp.uuid] ?? null;
              const followedSource = followedId
                ? sources.find((s) => s.id === followedId)
                : undefined;
              const isAnchorOfSelected =
                selectedSource != null && sp.uuid === selectedSource.anchorUuid;
              return (
                <SpeakerRow
                  key={sp.uuid}
                  uuid={sp.uuid}
                  name={sp.name}
                  followedSource={followedSource}
                  isAnchorOfSelected={isAnchorOfSelected}
                  onTap={() => onTapSpeaker(sp.uuid)}
                />
              );
            })}
          </div>
        </div>
      </div>

      {errorText && (
        <div style={{ marginTop: 12, fontSize: 11, color: "var(--amber)" }}>{errorText}</div>
      )}
    </Modal>
  );
}
