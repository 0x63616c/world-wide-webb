import { readdir, rename, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { defaultWakePhotoRoot } from "@features/wakes/photos";
import { wakePhoto } from "@features/wakes/schema";
import { nextFreeName, parseLegacyPhotoFileName, photoFileName } from "@www/core";
import { getLogger } from "@www/logger";
import { eq, like, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { boothPhoto } from "../db/schema";
import { defaultBoothPhotoRoot } from "../services/booth-photo-service";

/**
 * One-way migration from the legacy dated tree to flat ISO-instant names (spec
 * docs/superpowers/specs/2026-07-21-flat-iso-photo-paths-design.md):
 *
 *   2026/06/01/1784516886155-0.jpg  ->  2026-06-01T14-28-06.155Z-0.jpg
 *
 * Runs on every api boot, next to the wake-photo backfill and for the same
 * reason , a one-shot script is a thing someone has to remember to run, and the
 * api is the only process with the media volume mounted. It is idempotent and
 * cheap once done: a migrated row has no `/` in its path, so the driving query
 * returns nothing and the disk sweep finds no dated directories.
 *
 * The rename is BIJECTIVE. The new name comes from the row's `captured_at`
 * (authoritative, and a timestamptz rather than a stamp scraped from a
 * filename), and the legacy collision suffix is carried across verbatim. Two
 * files that were distinct before stay distinct after, so nothing needs
 * renumbering and no photo can be overwritten by another.
 *
 * Order per photo is FILE FIRST, ROW SECOND. The reverse points a live row at
 * bytes that are not there yet, which 404s in the gallery; this way the worst
 * interruption leaves a moved file with a stale row, which the next boot
 * finishes.
 */

/** Legacy paths always contain a directory separator; flat ones never do. */
const LEGACY_PATH_PATTERN = "%/%";

export interface PhotoPathMigrationResult {
  wake: number;
  booth: number;
  orphans: number;
}

/**
 * Move one file into place, tolerating a half-finished previous run.
 *
 * Returns false only when neither the source nor the destination exists, which
 * means the row points at bytes nobody has , the row is left alone for the
 * purge or the operator to deal with rather than being pointed somewhere wrong.
 */
async function moveFile(root: string, from: string, to: string): Promise<boolean> {
  try {
    await rename(join(root, from), join(root, to));
    return true;
  } catch {
    // Already moved by an interrupted earlier run: the destination is there and
    // the source is gone. Treat as done so the row update still happens.
    return await stat(join(root, to)).then(
      () => true,
      () => false,
    );
  }
}

/** Rename every indexed legacy photo in one table, returning how many moved. */
async function migrateIndexed(
  db: NodePgDatabase<typeof schema>,
  root: string,
  kind: "wake" | "booth",
): Promise<number> {
  const log = getLogger();
  let moved = 0;

  // `booth_photo` is keyed by its own id, `wake_photo` by the path itself , so
  // the update below addresses each by what identifies it. Selected into one
  // shape so the rename loop does not care which table it is walking.
  const rows: { id: string | null; path: string; capturedAt: Date }[] =
    kind === "wake"
      ? await db
          .select({ id: sql<null>`null`, path: wakePhoto.path, capturedAt: wakePhoto.capturedAt })
          .from(wakePhoto)
          .where(like(wakePhoto.path, LEGACY_PATH_PATTERN))
      : await db
          .select({ id: boothPhoto.id, path: boothPhoto.path, capturedAt: boothPhoto.capturedAt })
          .from(boothPhoto)
          .where(like(boothPhoto.path, LEGACY_PATH_PATTERN));

  for (const row of rows) {
    const base = row.path.split("/").pop() ?? "";
    const legacy = parseLegacyPhotoFileName(base);
    if (!legacy) {
      // Not a name this scheme ever produced. Leave it: a wrong guess here
      // renames someone's bytes to a timestamp that is not theirs.
      log.warn({ kind, path: row.path }, "skipping photo with unrecognised legacy name");
      continue;
    }

    // captured_at is authoritative; the legacy suffix preserves distinctness.
    const next = photoFileName(row.capturedAt, legacy.n, legacy.ext);
    if (!(await moveFile(root, row.path, next))) {
      log.warn({ kind, path: row.path }, "legacy photo bytes missing, leaving row unmigrated");
      continue;
    }

    if (row.id === null) {
      await db.update(wakePhoto).set({ path: next }).where(eq(wakePhoto.path, row.path));
    } else {
      await db.update(boothPhoto).set({ path: next }).where(eq(boothPhoto.id, row.id));
    }
    moved += 1;
  }

  return moved;
}

/**
 * Sweep the leftover YYYY/MM/DD tree for files no row ever pointed at (wake
 * photos predating the index), rename them into the flat scheme, and remove the
 * emptied directories.
 *
 * These get `nextFreeName` rather than their legacy suffix: without a row there
 * is nothing guaranteeing the suffix is still free at the destination, and an
 * unindexed file has no claim on a particular one. The wake backfill picks them
 * up on the same boot.
 */
async function sweepOrphans(root: string): Promise<number> {
  const log = getLogger();
  let moved = 0;

  const years = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const y of years) {
    if (!y.isDirectory() || !/^\d{4}$/.test(y.name)) continue;
    const months = await readdir(join(root, y.name), { withFileTypes: true }).catch(() => []);
    for (const m of months) {
      if (!m.isDirectory()) continue;
      const days = await readdir(join(root, y.name, m.name), { withFileTypes: true }).catch(
        () => [],
      );
      for (const d of days) {
        if (!d.isDirectory()) continue;
        const relDir = join(y.name, m.name, d.name);
        const files = await readdir(join(root, relDir)).catch(() => [] as string[]);
        for (const f of files) {
          const legacy = parseLegacyPhotoFileName(f);
          if (!legacy) continue;
          const next = await nextFreeName(root, legacy.capturedAt, legacy.ext);
          if (await moveFile(root, join(relDir, f), next)) moved += 1;
        }
        await rmdir(join(root, relDir)).catch(() => {});
      }
      await rmdir(join(root, y.name, m.name)).catch(() => {});
    }
    await rmdir(join(root, y.name)).catch(() => {});
  }

  if (moved > 0) log.info({ root, moved }, "moved unindexed legacy photos");
  return moved;
}

/** Migrate both photo stores. Safe to call on every boot. */
export async function migratePhotoPaths(
  db: NodePgDatabase<typeof schema>,
  wakeRoot = defaultWakePhotoRoot(),
  boothRoot = defaultBoothPhotoRoot(),
): Promise<PhotoPathMigrationResult> {
  const wake = await migrateIndexed(db, wakeRoot, "wake");
  const booth = await migrateIndexed(db, boothRoot, "booth");
  const orphans = (await sweepOrphans(wakeRoot)) + (await sweepOrphans(boothRoot));
  return { wake, booth, orphans };
}
