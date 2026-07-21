import { stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * The on-disk naming scheme for wake and booth photos (spec
 * docs/superpowers/specs/2026-07-21-flat-iso-photo-paths-design.md).
 *
 * One flat directory per kind; the filename carries the full capture instant:
 *
 *   <MEDIA_STORAGE_DIR>/booth-photos/2026-06-01T14-28-06.155Z-0.jpg
 *   <MEDIA_STORAGE_DIR>/wake-photos/2026-07-20T00-31-00.134Z-0.jpg
 *
 * This replaced YYYY/MM/DD/<epochMs>-<n>.<ext>. Three levels of nesting to reach
 * a photo, where `06` and `01` mean nothing on their own, and an epoch stamp no
 * human reads.
 *
 * Serving a photo is a named lookup (open() on a path the caller already has),
 * which ext4 resolves in roughly constant time at any directory size, so a flat
 * directory costs nothing on the hot path. The one directory-size-dependent
 * operation was the per-upload readdir that computed the collision suffix, and
 * `nextFreeName` below replaces it with a probe that terminates on the first
 * free slot.
 *
 * Because every filename carries its own instant, sharding this back into
 * directories later is a `mv` pass plus a `path` column rewrite. The FILENAME is
 * the durable decision; the directory is not.
 */

/** Times are always UTC. Local time would file a late-evening BST capture under
 * the next day and repeat an hour every autumn; `captured_at` in Postgres is
 * timestamptz and every UI renders local time from the COLUMN, never the path.
 * The path is an address, not a display value. */
const ISO_MS_LENGTH = "2026-06-01T14:28:06.155Z".length;

/**
 * ISO 8601 with `:` swapped for `-`.
 *
 * Strict extended format (`14:28:06`) is out: `:` is illegal on SMB and exFAT,
 * and macOS Finder renders it as `/`. This store is browsed over SMB. ISO basic
 * format (`20260601T142806Z`) is legal and conformant but is exactly the
 * unreadable shape this scheme exists to escape, so dashes it is , readable, at
 * the cost of strict conformance.
 *
 * Milliseconds and the `Z` are always present, so every name is fixed-width and
 * name-sort equals time-sort.
 */
export function instantToken(capturedAt: number | Date): string {
  const iso = new Date(capturedAt).toISOString();
  if (iso.length !== ISO_MS_LENGTH) {
    // toISOString only widens the year field, and only outside 0000-9999.
    throw new Error(`unrepresentable capture instant: ${iso}`);
  }
  return iso.replaceAll(":", "-");
}

/**
 * Build a photo filename.
 *
 * `n` is the same-millisecond COLLISION COUNTER, which is what the old `-<n>`
 * suffix always was , not a frame index. `wake_photo.frame_idx` is the real
 * frame index and is nullable precisely because backfilled rows never had one.
 */
export function photoFileName(capturedAt: number | Date, n: number, ext: string): string {
  return `${instantToken(capturedAt)}-${n}.${ext}`;
}

/**
 * The earliest instant a filename may claim. Anything older is a mis-parse, not
 * a real photo: the panel did not exist before this, and a name that parses to
 * 1970 would sit 56 years past the wake-photo retention cutoff and be unlinked
 * by the next nightly purge. Fail the parse instead of deleting someone's
 * photos.
 */
const EARLIEST_PLAUSIBLE_MS = Date.UTC(2020, 0, 1);

/** `<instant>-<n>.<ext>` where the instant's own dashes must not confuse the split. */
const PHOTO_NAME_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z)-(\d+)\.([a-z0-9]+)$/;

export interface ParsedPhotoName {
  capturedAt: number;
  n: number;
  ext: string;
}

/**
 * Recover the capture instant from a filename, or null if the name is not in
 * this scheme (or claims an implausible date).
 *
 * Deliberately strict. The predecessor parsed `Number(f.split("-")[0])`, which
 * on a name like `2026-06-01T14-28-06.155Z-0.jpg` yields `2026` , finite, so it
 * passes an isFinite guard, and indexes the photo at 1970-01-01T00:00:02.026Z.
 * A regex over the whole name cannot half-match its way into that.
 */
export function parsePhotoFileName(name: string): ParsedPhotoName | null {
  const m = PHOTO_NAME_RE.exec(name);
  if (!m) return null;
  const [, token, nRaw, ext] = m;
  const capturedAt = Date.parse(`${token.slice(0, 10)}T${token.slice(11).replaceAll("-", ":")}`);
  if (!Number.isFinite(capturedAt) || capturedAt < EARLIEST_PLAUSIBLE_MS) return null;
  return { capturedAt, n: Number(nRaw), ext };
}

/** The legacy scheme: YYYY/MM/DD/<epochMs>-<n>.<ext>. Only the migration and the
 * backfill still read it. */
const LEGACY_NAME_RE = /^(\d{10,})-(\d+)\.([a-z0-9]+)$/;

export function parseLegacyPhotoFileName(name: string): ParsedPhotoName | null {
  const m = LEGACY_NAME_RE.exec(name);
  if (!m) return null;
  const [, msRaw, nRaw, ext] = m;
  const capturedAt = Number(msRaw);
  if (!Number.isFinite(capturedAt) || capturedAt < EARLIEST_PLAUSIBLE_MS) return null;
  return { capturedAt, n: Number(nRaw), ext };
}

/**
 * First filename for this instant that is not already taken.
 *
 * Replaces the old `readdir(dayDir)`-and-count, which was bounded by the day's
 * file count , fine under a dated tree, the whole store under a flat one. This
 * probes `-0`, then `-1`, and so on, terminating on the first attempt in every
 * non-colliding case (which is all of them, outside a same-millisecond retry).
 */
export async function nextFreeName(
  root: string,
  capturedAt: number | Date,
  ext: string,
): Promise<string> {
  for (let n = 0; ; n++) {
    const name = photoFileName(capturedAt, n, ext);
    const taken = await stat(join(root, name)).then(
      () => true,
      () => false,
    );
    if (!taken) return name;
  }
}
