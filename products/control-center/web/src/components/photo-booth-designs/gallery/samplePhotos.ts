/**
 * samplePhotos , procedural sample data for the Photo Booth GALLERY design
 * prototypes. These are throwaway design mocks: no binary assets, no network,
 * no real photos. Each "photo" is an inline SVG data-URI (gradient + big emoji
 * + soft texture) so a story renders a believable wall of shots with zero
 * external dependencies.
 *
 * The array is built once at module load so every render sees identical,
 * stable data-URIs (regenerating per render would thrash decode + defeat
 * memoisation). Timestamps are anchored to the real "now" so the Today /
 * Yesterday / date-header grouping the designs rely on is genuinely live.
 *
 * Shared here (not per-design) so all ten concepts browse the same library and
 * agree on mode badges, filters, and time formatting , the differences between
 * designs are layout and mood, never the underlying data.
 */

export type PhotoMode = "photo" | "burst" | "4-frame" | "gif";

export type PhotoAspect = "portrait" | "landscape" | "square";

export interface Photo {
  id: string;
  /** Epoch ms. */
  capturedAt: number;
  mode: PhotoMode;
  /** Applied booth filter name (design chrome only). */
  filter: string;
  aspect: PhotoAspect;
  /**
   * Inline SVG data-URIs. One frame for photo/burst/gif; exactly four for a
   * 4-frame strip (rendered as a 2x2 grid within a single gallery item).
   */
  frames: string[];
  /** Shots in the burst (mode === "burst" only). */
  burstCount?: number;
  /** Loop length label for a gif (mode === "gif" only). */
  gifSeconds?: number;
  /** A short, human caption a few shots carry (design flavour). */
  caption?: string;
}

/** Per-mode display metadata , label, glyph, and accent used by every design. */
export const MODE_META: Record<PhotoMode, { label: string; glyph: string; tone: string }> = {
  photo: { label: "Photo", glyph: "", tone: "var(--ink-2)" },
  burst: { label: "Burst", glyph: "▤", tone: "var(--teal)" },
  "4-frame": { label: "4-Up", glyph: "☷", tone: "var(--acc)" },
  gif: { label: "GIF", glyph: "∞", tone: "var(--amber)" },
};

export const FILTERS = [
  "None",
  "Noir",
  "Vivid",
  "Faded",
  "Golden",
  "Frost",
  "Bubblegum",
  "Chrome",
] as const;

// ---- deterministic building blocks -----------------------------------------

/** Small, fast, seedable PRNG so the generated library is stable per module. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Gradient palettes , warm booth-strip film stock, not the cool dashboard UI.
const PALETTES: [string, string, string][] = [
  ["#ff8a5c", "#ff3d81", "#7a2ff2"],
  ["#22d3ee", "#3b82f6", "#1e1b4b"],
  ["#f9d423", "#ff4e50", "#7a1f3d"],
  ["#a8ff78", "#12c2b0", "#0b3d4d"],
  ["#f6d365", "#fda085", "#8a3b3b"],
  ["#c471f5", "#fa71cd", "#3a1c71"],
  ["#f0f4f8", "#c9d6df", "#4a5a6a"],
  ["#ffd26f", "#ff8c42", "#3d1f14"],
  ["#8ec5fc", "#e0c3fc", "#2d2a54"],
  ["#ff6a88", "#ff99ac", "#5a1e3a"],
];

const EMOJI = [
  "\u{1F604}",
  "\u{1F389}",
  "\u{1F60E}",
  "\u{1F436}",
  "\u{1F31F}",
  "\u{1F355}",
  "\u{1F984}",
  "\u{1F4F8}",
  "✌️",
  "\u{1F388}",
  "\u{1F308}",
  "\u{1F525}",
  "\u{1F4AB}",
  "\u{1F973}",
  "\u{1F9E2}",
  "\u{1F3B8}",
  "\u{1F366}",
  "\u{1F47E}",
  "\u{1F335}",
  "\u{1F419}",
];

function dims(aspect: PhotoAspect): [number, number] {
  if (aspect === "portrait") return [480, 640];
  if (aspect === "landscape") return [640, 420];
  return [560, 560];
}

/** Build one inline SVG data-URI , gradient wash, soft blobs, vignette, emoji. */
function svgPhoto(
  aspect: PhotoAspect,
  pal: [string, string, string],
  emoji: string,
  r: () => number,
): string {
  const [w, h] = dims(aspect);
  const gid = `g${Math.floor(r() * 1e6)}`;
  const vid = `v${Math.floor(r() * 1e6)}`;
  const angle = Math.floor(r() * 360);
  const blobs = Array.from({ length: 3 }, () => {
    const cx = Math.floor(r() * w);
    const cy = Math.floor(r() * h);
    const rad = Math.floor(40 + r() * 120);
    const op = (0.12 + r() * 0.18).toFixed(2);
    return `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="#fff" opacity="${op}"/>`;
  }).join("");
  const fontSize = Math.floor(Math.min(w, h) * 0.42);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs>` +
    `<linearGradient id="${gid}" gradientTransform="rotate(${angle} 0.5 0.5)">` +
    `<stop offset="0%" stop-color="${pal[0]}"/>` +
    `<stop offset="55%" stop-color="${pal[1]}"/>` +
    `<stop offset="100%" stop-color="${pal[2]}"/>` +
    `</linearGradient>` +
    `<radialGradient id="${vid}" cx="50%" cy="42%" r="75%">` +
    `<stop offset="60%" stop-color="#000" stop-opacity="0"/>` +
    `<stop offset="100%" stop-color="#000" stop-opacity="0.45"/>` +
    `</radialGradient>` +
    `</defs>` +
    `<rect width="${w}" height="${h}" fill="url(#${gid})"/>` +
    `<g style="mix-blend-mode:soft-light">${blobs}</g>` +
    `<rect width="${w}" height="${h}" fill="url(#${vid})"/>` +
    `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}">${emoji}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const CAPTIONS = [
  "friday night",
  "the whole crew",
  "pizza run",
  "matching hats",
  "post-gig glow",
  "sunday roast people",
];

// ---- library assembly ------------------------------------------------------

// Photos per day, most recent first. Anchored to real "now" so Today /
// Yesterday headers are live. Index 0 = today, 1 = yesterday, then back.
const DAY_COUNTS = [6, 5, 4, 3, 2];
const DAY_OFFSETS = [0, 1, 2, 4, 6];

const MODE_CYCLE: PhotoMode[] = [
  "photo",
  "4-frame",
  "photo",
  "burst",
  "photo",
  "gif",
  "photo",
  "4-frame",
  "photo",
  "burst",
];
const ASPECT_CYCLE: PhotoAspect[] = ["square", "portrait", "landscape", "square", "portrait"];

function buildLibrary(): Photo[] {
  const rnd = mulberry32(0x5eed);
  const now = Date.now();
  const dayMs = 86_400_000;
  const out: Photo[] = [];
  let n = 0;

  DAY_COUNTS.forEach((count, dayIdx) => {
    const dayStart = now - DAY_OFFSETS[dayIdx] * dayMs;
    for (let i = 0; i < count; i++) {
      const mode = MODE_CYCLE[n % MODE_CYCLE.length];
      const aspect: PhotoAspect =
        mode === "4-frame" ? "square" : ASPECT_CYCLE[n % ASPECT_CYCLE.length];
      const pal = PALETTES[n % PALETTES.length];
      // Spread across the day's afternoon/evening, newest photo first.
      const hourSpan = 9 * 3_600_000;
      const capturedAt =
        dayStart - Math.floor((i / count) * hourSpan) - Math.floor(rnd() * 1_600_000);

      const frameCount = mode === "4-frame" ? 4 : 1;
      const frames = Array.from({ length: frameCount }, (_, f) =>
        svgPhoto(
          aspect,
          PALETTES[(n + f) % PALETTES.length],
          EMOJI[(n * 3 + f) % EMOJI.length],
          rnd,
        ),
      );

      out.push({
        id: `pho_${(1000 + n).toString(36)}`,
        capturedAt,
        mode,
        filter: FILTERS[n % FILTERS.length],
        aspect,
        frames,
        burstCount: mode === "burst" ? 8 + ((n * 3) % 22) : undefined,
        gifSeconds: mode === "gif" ? 2 + (n % 3) : undefined,
        caption: n % 4 === 0 ? CAPTIONS[n % CAPTIONS.length] : undefined,
      });
      // keep palette/emoji marching so the wall never repeats two in a row
      void pal;
      n++;
    }
  });

  return out;
}

export const samplePhotos: Photo[] = buildLibrary();

// ---- shared formatting helpers ---------------------------------------------

export interface PhotoDay {
  /** Midnight epoch ms for the bucket. */
  key: number;
  /** "Today" / "Yesterday" / "Mon 14 Jul". */
  label: string;
  photos: Photo[];
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Group newest-first into day buckets with human labels. */
export function groupByDay(photos: Photo[]): PhotoDay[] {
  const today = startOfDay(Date.now());
  const dayMs = 86_400_000;
  const buckets = new Map<number, Photo[]>();
  for (const p of photos) {
    const key = startOfDay(p.capturedAt);
    const list = buckets.get(key);
    if (list) list.push(p);
    else buckets.set(key, [p]);
  }
  return [...buckets.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([key, list]) => {
      let label: string;
      if (key === today) label = "Today";
      else if (key === today - dayMs) label = "Yesterday";
      else
        label = new Date(key).toLocaleDateString([], {
          weekday: "short",
          day: "numeric",
          month: "short",
        });
      return { key, label, photos: list.sort((a, b) => b.capturedAt - a.capturedAt) };
    });
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDayStamp(ms: number): string {
  return new Date(ms).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
}

export function formatCount(photos: Photo[]): string {
  return photos.length === 1 ? "1 photo" : `${photos.length} photos`;
}
