import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { getLogger } from "@www/logger";
import { env } from "../env";

/**
 * Wake photos: front-camera burst frames the wall panel uploads every time it
 * is woken from its idle dim. The filesystem IS the store , no DB table. Files
 * live at <MEDIA_STORAGE_DIR>/wake-photos/YYYY/MM/DD/<capturedAt>-<n>.jpg and
 * the dated directory tree doubles as the listing's day grouping.
 */

export interface WakePhotoDay {
  /** YYYY-MM-DD */
  day: string;
  photos: { path: string; capturedAt: number }[];
}

export interface WakePhotoListing {
  days: WakePhotoDay[];
  totalCount: number;
  totalBytes: number;
}

/** JPEG SOI + marker prefix , the only content type the panel uploads. */
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const MAX_BYTES = 2 * 1024 * 1024;

function defaultRoot(): string {
  return join(env.MEDIA_STORAGE_DIR, "wake-photos");
}

function dayDirFor(capturedAt: number): { rel: string; day: string } {
  // UTC day buckets , timezone-stable regardless of where api/tests run.
  const d = new Date(capturedAt);
  const y = String(d.getUTCFullYear());
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return { rel: join(y, m, dd), day: `${y}-${m}-${dd}` };
}

/**
 * Validate and persist one burst frame. Returns the stored path relative to the
 * wake-photos root (the same path GET /media/wake-photos/<rel> serves).
 * Throws on non-JPEG content or oversize bodies (services-throw convention).
 */
export async function saveWakePhoto(
  bytes: Uint8Array,
  capturedAt: number,
  root = defaultRoot(),
): Promise<string> {
  if (bytes.length > MAX_BYTES) {
    throw new Error(`wake photo too large: ${bytes.length} bytes (max ${MAX_BYTES})`);
  }
  if (bytes.length < JPEG_MAGIC.length || !JPEG_MAGIC.every((b, i) => bytes[i] === b)) {
    throw new Error("wake photo is not a JPEG");
  }
  const { rel } = dayDirFor(capturedAt);
  const dir = join(root, rel);
  await mkdir(dir, { recursive: true });
  // Burst frames share a wake but not a timestamp (each frame stamps its own
  // capture time), so collisions only happen on a same-ms retry , suffix with
  // the count of existing same-ts files to keep every frame.
  const existing = (await readdir(dir)).filter((f) => f.startsWith(`${capturedAt}-`));
  const relPath = join(rel, `${capturedAt}-${existing.length}.jpg`);
  await writeFile(join(root, relPath), bytes);
  getLogger().info({ relPath, bytes: bytes.length }, "wake photo stored");
  return relPath;
}

/**
 * Walk the dated tree into a newest-first listing (days desc, photos within a
 * day desc by capture time). Sizes are summed for the viewer's storage stat.
 * A missing root (no photo ever taken) is an empty listing, not an error.
 */
export async function listWakePhotos(root = defaultRoot()): Promise<WakePhotoListing> {
  const days: WakePhotoDay[] = [];
  let totalCount = 0;
  let totalBytes = 0;

  let years: string[];
  try {
    years = await readdir(root);
  } catch {
    return { days: [], totalCount: 0, totalBytes: 0 };
  }

  for (const y of years.sort().reverse()) {
    const months = await readdir(join(root, y)).catch(() => [] as string[]);
    for (const m of months.sort().reverse()) {
      const dayDirs = await readdir(join(root, y, m)).catch(() => [] as string[]);
      for (const dd of dayDirs.sort().reverse()) {
        const files = await readdir(join(root, y, m, dd)).catch(() => [] as string[]);
        const photos: WakePhotoDay["photos"] = [];
        for (const f of files) {
          if (!f.endsWith(".jpg")) continue;
          const capturedAt = Number(f.split("-")[0]);
          if (!Number.isFinite(capturedAt)) continue;
          const s = await stat(join(root, y, m, dd, f)).catch(() => null);
          if (!s) continue;
          photos.push({ path: join(y, m, dd, f), capturedAt });
          totalCount += 1;
          totalBytes += s.size;
        }
        if (photos.length === 0) continue;
        photos.sort((a, b) => b.capturedAt - a.capturedAt);
        days.push({ day: `${y}-${m}-${dd}`, photos });
      }
    }
  }

  return { days, totalCount, totalBytes };
}

/**
 * Read one stored photo by its listing path. Returns null for missing files or
 * any path that escapes the wake-photos root (traversal), so the route layer
 * can 404 both without distinguishing.
 */
export async function readWakePhoto(
  relPath: string,
  root = defaultRoot(),
): Promise<{ bytes: Uint8Array<ArrayBuffer> } | null> {
  const abs = resolve(root, relPath);
  if (abs !== resolve(root) && !abs.startsWith(resolve(root) + sep)) return null;
  try {
    return { bytes: new Uint8Array(await readFile(abs)) };
  } catch {
    return null;
  }
}
