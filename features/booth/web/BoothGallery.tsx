/**
 * BoothGallery , the photo-booth gallery page (productionised from the
 * "Minimal Squares" prototype, GalleryDesign10).
 *
 * Edge-to-edge uniform square grid, oversized bold date headers, mode carried
 * by a single tinted dot, and a quiet typographic lightbox. A 4-frame capture
 * shows as one composite 2x2 cell; a burst shows its first frame as the cover
 * and the lightbox steps through every frame.
 *
 * Presentational , data arrives via props (the `booth-photos` detail wiring runs
 * `boothPhotos.list` and passes the groups + a `photoUrl` builder, exactly as
 * the Activity page's wiring does), so Storybook exercises the populated and
 * empty states without a backend. Delete is optimistic: the group vanishes from
 * the grid immediately and `onRemove` fires the `boothPhotos.remove` mutation.
 *
 * Share is the one native seam: on the Capacitor shell it opens the iOS share
 * sheet, and it is a no-op in a plain browser / Storybook.
 */

import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { groupByDay } from "@/components/gallery/group-by-day";
import { PhotoGrid } from "@/components/gallery/PhotoGrid";
import { ConfirmDialog, PageHeader } from "@/components/ui";
import type { RouterOutputs } from "@/lib/trpc";
import { bakeFilterIntoImage } from "./lib/booth-capture";
import { filterCssFor } from "./lib/booth-filters";

/** One capture group as the gallery reads it (the backend listing contract). */
export type BoothGroup = RouterOutputs["boothPhotos"]["list"]["groups"][number];
type BoothMode = BoothGroup["mode"];

export interface BoothGalleryProps {
  /** Capture groups, newest-first, frames ordered by frame index. */
  groups: BoothGroup[];
  /** Maps a listing path to a fetchable URL (the /media/booth-photos/ route). */
  photoUrl: (path: string) => string;
  /** Reversibly remove a whole capture (fires boothPhotos.remove). */
  onRemove: (groupId: string) => void;
  /** Return to the camera. */
  onBack: () => void;
}

/** Non-photo modes carry a single tinted dot on their grid cell. */
const MODE_DOT: Record<BoothMode, string | null> = {
  photo: null,
  burst: "var(--teal)",
  four_frame: "var(--acc)",
  gif: "var(--amber)",
};

const MODE_LABEL: Record<BoothMode, string> = {
  photo: "Photo",
  burst: "Burst",
  four_frame: "4-Up",
  gif: "GIF",
};

export function BoothGallery({ groups, photoUrl, onRemove, onBack }: BoothGalleryProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [confirmGroupId, setConfirmGroupId] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const live = useMemo(() => groups.filter((g) => !removed.has(g.groupId)), [groups, removed]);
  const days = useMemo(() => groupByDay(live, (g) => g.capturedAt), [live]);
  const photoCount = useMemo(() => live.reduce((n, g) => n + g.frames.length, 0), [live]);

  // The lightbox walks the whole roll as one flat, time-ordered list. A 4-frame
  // capture contributes a single composite view; a burst contributes one view
  // per frame; everything else one view. `coverIndex` maps a grid cell (group)
  // to the first view it opens on.
  const { views, coverIndex } = useMemo(() => buildViews(live), [live]);

  const open = openIndex != null ? (views[openIndex] ?? null) : null;

  // Escape closes; arrows step the roll. Bound only while the lightbox is open.
  useEffect(() => {
    if (open == null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenIndex(null);
      else if (e.key === "ArrowLeft") setOpenIndex((i) => (i != null && i > 0 ? i - 1 : i));
      else if (e.key === "ArrowRight")
        setOpenIndex((i) => (i != null && i < views.length - 1 ? i + 1 : i));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, views.length]);

  function confirmRemove(groupId: string) {
    setRemoved((prev) => new Set(prev).add(groupId));
    setOpenIndex(null);
    setConfirmGroupId(null);
    onRemove(groupId);
  }

  return (
    <div style={pageRoot}>
      <PageHeader
        title="Photos"
        onBack={onBack}
        right={
          <span style={{ fontSize: 15, fontWeight: 500, color: "var(--ink-3)" }}>
            {photoCount === 1 ? "1 photo" : `${photoCount} photos`}
          </span>
        }
      />

      <div style={scrollRegion} className="modal-scroll">
        <PhotoGrid
          days={days.map((day) => ({
            key: day.key,
            label: day.label,
            count: day.items.length,
            items: day.items,
          }))}
          itemKey={(g) => g.groupId}
          cellLabel={(g) => `Open ${MODE_LABEL[g.mode]} from ${formatTime(g.capturedAt)}`}
          onSelect={(g) => setOpenIndex(coverIndex.get(g.groupId) ?? 0)}
          renderCell={(g) => (
            <Cover group={g} photoUrl={photoUrl} filterCss={filterCssFor(g.filter)} />
          )}
          renderOverlay={(g) =>
            MODE_DOT[g.mode] != null ? (
              <span style={{ ...dot, background: MODE_DOT[g.mode] as string }} />
            ) : null
          }
          empty={<EmptyState />}
        />
      </div>

      {open != null && openIndex != null && (
        <Lightbox
          view={open}
          photoUrl={photoUrl}
          filter={open.filter}
          hasPrev={openIndex > 0}
          hasNext={openIndex < views.length - 1}
          onPrev={() => setOpenIndex((i) => (i != null && i > 0 ? i - 1 : i))}
          onNext={() => setOpenIndex((i) => (i != null && i < views.length - 1 ? i + 1 : i))}
          onClose={() => setOpenIndex(null)}
          onDelete={() => setConfirmGroupId(open.groupId)}
        />
      )}

      <ConfirmDialog
        open={confirmGroupId !== null}
        tone="danger"
        title="Delete photo?"
        message="This photo will be removed from your booth."
        confirmLabel="Delete"
        onClose={() => setConfirmGroupId(null)}
        onConfirm={() => confirmGroupId && confirmRemove(confirmGroupId)}
      />
    </div>
  );
}

// ---- grid cover ------------------------------------------------------------

/**
 * A grid cell's pixels: a 4-frame capture as a 2x2 strip inside one square,
 * everything else as its first frame. `filterCss` is the display-time
 * (non-destructive) filter applied to the raw stored pixels.
 */
function Cover({
  group,
  photoUrl,
  filterCss,
}: {
  group: BoothGroup;
  photoUrl: (path: string) => string;
  filterCss: string;
}) {
  if (group.mode === "four_frame") {
    return (
      <div style={compositeGrid}>
        {group.frames.slice(0, 4).map((f) => (
          <img
            key={f.id}
            src={photoUrl(f.path)}
            alt=""
            style={{ ...compositeCell, filter: filterCss }}
          />
        ))}
      </div>
    );
  }
  return (
    <img
      src={photoUrl(group.frames[0].path)}
      alt=""
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        display: "block",
        filter: filterCss,
      }}
    />
  );
}

// ---- lightbox --------------------------------------------------------------

interface LightboxView {
  /** Owning capture group (delete acts on the whole group). */
  groupId: string;
  mode: BoothMode;
  capturedAt: number;
  /** The group's stored (raw) filter id, or null; the gallery may clear it locally. */
  filter: string | null;
  /** Render as a 2x2 composite (`paths.length === 4`) or a single frame. */
  composite: boolean;
  paths: string[];
}

function Lightbox({
  view,
  photoUrl,
  filter,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onDelete,
}: {
  view: LightboxView;
  photoUrl: (path: string) => string;
  /** The capture's stored filter id, or null when bare. */
  filter: string | null;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const filterCss = filterCssFor(filter);
  return (
    <div style={overlay}>
      {/* Backdrop , tapping anywhere outside the image (or Escape) closes. */}
      <button type="button" aria-label="Close" onClick={onClose} style={scrim} />

      <button type="button" onClick={onDelete} aria-label="Delete" style={cornerBtn("top-left")}>
        <TrashIcon />
      </button>
      <button
        type="button"
        onClick={() => void shareView(view, photoUrl, filter)}
        aria-label="Share"
        style={cornerBtn("bottom-right")}
      >
        <ShareIcon />
      </button>

      <div style={stage}>
        <div style={dateBlock}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>
            {formatDayStamp(view.capturedAt)}
          </div>
          <div
            className="mono"
            style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", marginTop: 4 }}
          >
            {formatTime(view.capturedAt)}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>
            {MODE_LABEL[view.mode]}
          </div>
        </div>

        <button
          type="button"
          onClick={onPrev}
          disabled={!hasPrev}
          aria-label="Previous"
          style={navBtn(hasPrev)}
        >
          <ChevronIcon dir="left" />
        </button>

        <div style={imgWrap}>
          {view.composite ? (
            <div style={{ ...compositeGrid, borderRadius: 10 }}>
              {view.paths.slice(0, 4).map((p) => (
                <img
                  key={p}
                  src={photoUrl(p)}
                  alt=""
                  style={{ ...compositeCell, filter: filterCss }}
                />
              ))}
            </div>
          ) : (
            <img
              src={photoUrl(view.paths[0])}
              alt=""
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                display: "block",
                filter: filterCss,
              }}
            />
          )}
        </div>

        <button
          type="button"
          onClick={onNext}
          disabled={!hasNext}
          aria-label="Next"
          style={navBtn(hasNext)}
        >
          <ChevronIcon dir="right" />
        </button>
      </div>
    </div>
  );
}

// ---- native share seam -----------------------------------------------------

/**
 * Hand a captured frame to the OS share sheet. On the Capacitor shell this is
 * the real iOS sheet; in a plain browser it falls back to the Web Share API and
 * is otherwise a silent no-op (Storybook / desktop), so a share button that is
 * part of the fixed lightbox layout never throws where sharing is unavailable.
 *
 * Filters are non-destructive, so a filtered share must flatten the effect into
 * pixels at this moment (the stored bytes are raw). A baked frame becomes a
 * File shared through the Web Share files API where supported, else a data URL;
 * an unfiltered share keeps the lighter link-to-the-stored-file path.
 */
async function shareView(
  view: LightboxView,
  photoUrl: (path: string) => string,
  filter: string | null,
): Promise<void> {
  const rawUrl = new URL(photoUrl(view.paths[0]), window.location.origin).href;
  const css = filterCssFor(filter);
  try {
    if (filter != null && css !== "none") {
      await shareBakedFilter(rawUrl, css);
    } else {
      await shareUrl(rawUrl);
    }
  } catch {
    // A cancelled or unsupported share must never crash the gallery.
  }
}

/** Share a stored file by link (unfiltered path): native sheet, then Web Share. */
async function shareUrl(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Share.share({ title: "Photo booth", url });
  } else if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    await navigator.share({ title: "Photo booth", url });
  }
}

/** Bake the filter into pixels, then share the resulting image bytes. */
async function shareBakedFilter(rawUrl: string, css: string): Promise<void> {
  const blob = await bakeFilterIntoImage(rawUrl, css);
  const file = new File([blob], "photo-booth.jpg", { type: "image/jpeg" });
  if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title: "Photo booth", files: [file] });
    return;
  }
  // Where the files API is unavailable (the Capacitor shell), hand the baked
  // bytes to the native sheet as a data URL.
  const dataUrl = await blobToDataUrl(blob);
  if (Capacitor.isNativePlatform()) {
    await Share.share({ title: "Photo booth", url: dataUrl });
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ---- view assembly ---------------------------------------------------------

function buildViews(groups: BoothGroup[]): {
  views: LightboxView[];
  coverIndex: Map<string, number>;
} {
  const views: LightboxView[] = [];
  const coverIndex = new Map<string, number>();
  for (const g of groups) {
    coverIndex.set(g.groupId, views.length);
    if (g.mode === "four_frame") {
      views.push({
        groupId: g.groupId,
        mode: g.mode,
        capturedAt: g.capturedAt,
        filter: g.filter,
        composite: true,
        paths: g.frames.map((f) => f.path),
      });
    } else if (g.mode === "burst") {
      for (const f of g.frames) {
        views.push({
          groupId: g.groupId,
          mode: g.mode,
          capturedAt: f.capturedAt,
          filter: g.filter,
          composite: false,
          paths: [f.path],
        });
      }
    } else {
      views.push({
        groupId: g.groupId,
        mode: g.mode,
        capturedAt: g.capturedAt,
        filter: g.filter,
        composite: false,
        paths: [g.frames[0].path],
      });
    }
  }
  return { views, coverIndex };
}

// ---- formatting -------------------------------------------------------------

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDayStamp(ms: number): string {
  return new Date(ms).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
}

// ---- empty state -----------------------------------------------------------

function EmptyState() {
  return (
    <div style={emptyRoot}>
      <div style={emptyBadge}>
        <CameraGlyph />
      </div>
      <div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>No photos yet</h2>
        <p style={{ margin: "8px 0 0", color: "var(--ink-2)", fontSize: 15, maxWidth: 360 }}>
          Shots you take in the booth show up here, grouped by day. Strike a pose to get started.
        </p>
      </div>
    </div>
  );
}

// ---- inline line icons -----------------------------------------------------
// The house Icon set has no share/trash/chevron-left glyph, so the few the
// lightbox needs live here as stroke-currentColor SVGs (copied from the design
// prototype, which is removed once this ships).

function TrashIcon() {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v13" />
      <path d="M8 7l4-4 4 4" />
      <path d="M6 12H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}

function ChevronIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      width={30}
      height={30}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: dir === "left" ? "scaleX(-1)" : undefined }}
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

function CameraGlyph() {
  return (
    <svg
      width={46}
      height={46}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  );
}

// ---- styles ----------------------------------------------------------------

const pageRoot: CSSProperties = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
  background: "var(--bg)",
  color: "var(--ink)",
};

const scrollRegion: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  padding: "0 0 40px",
};

const dot: CSSProperties = {
  position: "absolute",
  top: 8,
  right: 8,
  width: 8,
  height: 8,
  borderRadius: "50%",
  boxShadow: "0 0 0 2px rgba(0,0,0,0.4)",
};

const compositeGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gridTemplateRows: "1fr 1fr",
  gap: 3,
  background: "#000",
  width: "100%",
  height: "100%",
};

const compositeCell: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
};

const overlay: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 60,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0,0,0,0.92)",
};

const scrim: CSSProperties = {
  position: "absolute",
  inset: 0,
  border: "none",
  background: "transparent",
  cursor: "default",
};

const stage: CSSProperties = {
  position: "relative",
  zIndex: 1,
  display: "flex",
  alignItems: "center",
  gap: 24,
};

const dateBlock: CSSProperties = {
  textAlign: "right",
  width: 150,
  flexShrink: 0,
};

const imgWrap: CSSProperties = {
  position: "relative",
  width: 760,
  height: 720,
  borderRadius: 10,
  overflow: "hidden",
  background: "#000",
  flexShrink: 0,
};

function navBtn(enabled: boolean): CSSProperties {
  return {
    width: 60,
    height: 60,
    borderRadius: "50%",
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.08)",
    color: "#fff",
    display: "grid",
    placeItems: "center",
    cursor: enabled ? "pointer" : "default",
    opacity: enabled ? 1 : 0.25,
    flexShrink: 0,
  };
}

function cornerBtn(corner: "top-left" | "bottom-right"): CSSProperties {
  const base: CSSProperties = {
    position: "absolute",
    zIndex: 2,
    width: 52,
    height: 52,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.1)",
    color: "#fff",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
  };
  if (corner === "top-left") return { ...base, top: 28, left: 28, color: "#ff6b6b" };
  return { ...base, bottom: 28, right: 28 };
}

const emptyRoot: CSSProperties = {
  height: "100%",
  minHeight: 640,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  gap: 20,
};

const emptyBadge: CSSProperties = {
  width: 108,
  height: 108,
  borderRadius: 28,
  border: "1px solid var(--hair)",
  background: "var(--nest)",
  display: "grid",
  placeItems: "center",
  color: "var(--ink-3)",
};
