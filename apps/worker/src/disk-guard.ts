/**
 * Free-space guard for the NAS media volume. Checked before claiming an ingest
 * so a full volume cannot be filled further by a new download.
 *
 * The floor is well above one file's size because the check runs BEFORE the
 * download and yt-dlp cannot say in advance how large the result will be: a
 * single 90-minute AV1 set is plausibly 3-8 GB, so a 10 GB floor could be
 * consumed by one job.
 */
import { statfsSync } from "node:fs";
import { getLogger } from "@www/logger";

const DISK_FREE_THRESHOLD_BYTES = 50 * 1024 * 1024 * 1024; // 50 GB

export function hasSufficientDisk(
  dir: string,
  thresholdBytes: number = DISK_FREE_THRESHOLD_BYTES,
): boolean {
  try {
    const stats = statfsSync(dir);
    // bavail = blocks available to non-root; bsize = block size in bytes.
    const freeBytes = stats.bavail * stats.bsize;
    if (freeBytes < thresholdBytes) {
      getLogger().warn({ freeBytes, thresholdBytes, dir }, "disk below threshold, skipping claim");
      return false;
    }
    return true;
  } catch (err) {
    // statfs failed (dir missing, NFS not mounted yet). Allow, and let the
    // download fail with a clearer error than a startup crash.
    getLogger().warn({ err, dir }, "statfs failed, assuming sufficient");
    return true;
  }
}
