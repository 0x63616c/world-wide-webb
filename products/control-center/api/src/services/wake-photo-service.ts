import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { getLogger } from "@www/logger";
import { desc } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { wakePhoto } from "../db/schema";
import { env } from "../env";

/**
 * Wake photos: front-camera burst frames the wall panel uploads every time it
 * is woken from its idle dim. The BYTES live on the filesystem at
 * <MEDIA_STORAGE_DIR>/wake-photos/YYYY/MM/DD/<capturedAt>-<n>.jpg; the INDEX
 * lives in Postgres (`wake_photo`), one row per frame, carrying the interaction
 * session the frame belongs to (spec
 * docs/specs/2026-07-18-interaction-logging-design.md).
 *
 * The dated tree used to BE the store , listing walked it, and a timestamp in a
 * filename was the only metadata a photo had. The table is what lets a frame be
 * correlated with a session, attributed to a device, and purged by a cheap
 * cutoff query. `backfillWakePhotoIndex` heals the gap for photos that predate
 * the table (their rows are honestly NULL on everything the filename never
 * carried).
 */

export interface WakePhotoDay {
  /** YYYY-MM-DD */
  day: string;
  photos: {
    path: string;
    capturedAt: number;
    /**
     * The visit this frame belongs to, so the viewer can open the session it
     * came from. Null for frames that predate the session table (backfilled)
     * or whose burst was never correlated , honestly unopenable.
     */
    interactionSessionId: string | null;
  }[];
}

export interface WakePhotoListing {
  days: WakePhotoDay[];
  totalCount: number;
  totalBytes: number;
}

export interface WakePhotoMeta {
  capturedAt: number;
  deviceId: string | null;
  sessionId: string | null;
  /** 0-based position within the burst. */
  frameIdx: number;
}

/** JPEG SOI + marker prefix , the only content type the panel uploads. */
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const MAX_BYTES = 2 * 1024 * 1024;

export function defaultWakePhotoRoot(): string {
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
 * Validate and persist one burst frame: bytes to disk, index row to Postgres.
 * Returns the stored path relative to the wake-photos root (the same path
 * GET /media/wake-photos/<rel> serves). Throws on non-JPEG content or oversize
 * bodies (services-throw convention).
 *
 * Disk write happens FIRST. If the row insert then fails we are left with an
 * unindexed file, which the backfill (see backfillWakePhotoIndex) heals; the
 * reverse order would leave a row pointing at bytes that do not exist, which
 * nothing can heal and which 404s in the viewer.
 */
export async function saveWakePhoto(
  db: NodePgDatabase<typeof schema>,
  bytes: Uint8Array,
  meta: WakePhotoMeta,
  root = defaultWakePhotoRoot(),
): Promise<string> {
  if (bytes.length > MAX_BYTES) {
    throw new Error(`wake photo too large: ${bytes.length} bytes (max ${MAX_BYTES})`);
  }
  if (bytes.length < JPEG_MAGIC.length || !JPEG_MAGIC.every((b, i) => bytes[i] === b)) {
    throw new Error("wake photo is not a JPEG");
  }
  const { rel } = dayDirFor(meta.capturedAt);
  const dir = join(root, rel);
  await mkdir(dir, { recursive: true });
  // Burst frames share a wake but not a timestamp (each frame stamps its own
  // capture time), so collisions only happen on a same-ms retry , suffix with
  // the count of existing same-ts files to keep every frame.
  const existing = (await readdir(dir)).filter((f) => f.startsWith(`${meta.capturedAt}-`));
  const relPath = join(rel, `${meta.capturedAt}-${existing.length}.jpg`);
  await writeFile(join(root, relPath), bytes);

  await db
    .insert(wakePhoto)
    .values({
      path: relPath,
      capturedAt: new Date(meta.capturedAt),
      interactionSessionId: meta.sessionId,
      deviceId: meta.deviceId,
      frameIdx: meta.frameIdx,
      bytes: bytes.length,
    })
    // A same-path retry re-uploads identical bytes; the row is already correct.
    .onConflictDoNothing();

  getLogger().info(
    { relPath, bytes: bytes.length, sessionId: meta.sessionId },
    "wake photo stored",
  );
  return relPath;
}

/**
 * Walk the dated tree into a flat, unsorted list of what is physically on disk.
 * Retained (from the tree-walk listing era) as the backfill's source of truth ,
 * the filesystem is authoritative for BYTES, the table for metadata.
 */
async function walkPhotoFiles(
  root: string,
): Promise<{ path: string; capturedAt: number; bytes: number }[]> {
  const out: { path: string; capturedAt: number; bytes: number }[] = [];

  let years: string[];
  try {
    years = await readdir(root);
  } catch {
    return out;
  }

  for (const y of years) {
    const months = await readdir(join(root, y)).catch(() => [] as string[]);
    for (const m of months) {
      const dayDirs = await readdir(join(root, y, m)).catch(() => [] as string[]);
      for (const dd of dayDirs) {
        const files = await readdir(join(root, y, m, dd)).catch(() => [] as string[]);
        for (const f of files) {
          if (!f.endsWith(".jpg")) continue;
          const capturedAt = Number(f.split("-")[0]);
          if (!Number.isFinite(capturedAt)) continue;
          const s = await stat(join(root, y, m, dd, f)).catch(() => null);
          if (!s) continue;
          out.push({ path: join(y, m, dd, f), capturedAt, bytes: s.size });
        }
      }
    }
  }

  return out;
}

/**
 * Index every photo on disk that has no row yet.
 *
 * The filesystem was the store for the whole life of this feature, so history
 * predates the table. Idempotent (`onConflictDoNothing` on the path PK) so it is
 * safe to run on every api boot , which is how it runs, rather than as a
 * one-shot script someone has to remember to invoke.
 *
 * Backfilled rows are honestly incomplete: the old filename encoded only a
 * capture timestamp, so session, device and frame index are all NULL. That is
 * the truth about those photos and the viewer renders them as unattributed
 * rather than guessing.
 */
export async function backfillWakePhotoIndex(
  db: NodePgDatabase<typeof schema>,
  root = defaultWakePhotoRoot(),
): Promise<{ inserted: number; scanned: number }> {
  const onDisk = await walkPhotoFiles(root);
  if (onDisk.length === 0) return { inserted: 0, scanned: 0 };

  let inserted = 0;
  for (const photo of onDisk) {
    const res = await db
      .insert(wakePhoto)
      .values({
        path: photo.path,
        capturedAt: new Date(photo.capturedAt),
        interactionSessionId: null,
        deviceId: null,
        frameIdx: null,
        bytes: photo.bytes,
      })
      .onConflictDoNothing();
    inserted += res.rowCount ?? 0;
  }
  return { inserted, scanned: onDisk.length };
}

/**
 * Day-grouped listing, newest first, read from the index.
 *
 * Returns the identical shape the tree walk did , the viewer and tile are
 * unchanged by the storage move.
 */
export async function listWakePhotos(db: NodePgDatabase<typeof schema>): Promise<WakePhotoListing> {
  const rows = await db.select().from(wakePhoto).orderBy(desc(wakePhoto.capturedAt));

  const byDay = new Map<string, WakePhotoDay>();
  let totalBytes = 0;
  for (const row of rows) {
    const day = row.capturedAt.toISOString().slice(0, 10);
    let bucket = byDay.get(day);
    if (!bucket) {
      bucket = { day, photos: [] };
      byDay.set(day, bucket);
    }
    bucket.photos.push({
      path: row.path,
      capturedAt: row.capturedAt.getTime(),
      interactionSessionId: row.interactionSessionId,
    });
    totalBytes += row.bytes;
  }

  return { days: [...byDay.values()], totalCount: rows.length, totalBytes };
}

/**
 * Read one stored photo by its listing path. Returns null for missing files or
 * any path that escapes the wake-photos root (traversal), so the route layer
 * can 404 both without distinguishing.
 */
export async function readWakePhoto(
  relPath: string,
  root = defaultWakePhotoRoot(),
): Promise<{ bytes: Uint8Array<ArrayBuffer> } | null> {
  const abs = resolve(root, relPath);
  if (abs !== resolve(root) && !abs.startsWith(resolve(root) + sep)) return null;
  try {
    return { bytes: new Uint8Array(await readFile(abs)) };
  } catch {
    return null;
  }
}

/** Delete one stored photo's bytes. Missing files are fine (see purge). */
export async function deleteWakePhotoFile(relPath: string, root = defaultWakePhotoRoot()) {
  await unlink(join(root, relPath)).catch(() => {});
}
