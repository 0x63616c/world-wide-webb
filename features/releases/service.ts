import { getLogger } from "@www/logger";
import { eq, lt } from "drizzle-orm";
import { appIdSchema, releaseInputSchema } from "./contract";
import { db } from "./db";
import { latestReleases } from "./schema";

export function createReleaseService(database: typeof db) {
  const latest = async (app: string) => {
    const [row] = await database
      .select()
      .from(latestReleases)
      .where(eq(latestReleases.app, appIdSchema.parse(app)))
      .limit(1);
    return row ? { ...row, updatedAt: row.updatedAt.toISOString() } : null;
  };
  return {
    latest,
    async record(raw: { app: string; build: number }) {
      const input = releaseInputSchema.parse(raw);
      // One atomic conditional upsert: equal/older retries preserve the timestamp too.
      const changed = await database
        .insert(latestReleases)
        .values(input)
        .onConflictDoUpdate({
          target: latestReleases.app,
          set: { build: input.build, updatedAt: new Date() },
          setWhere: lt(latestReleases.build, input.build),
        })
        .returning();
      getLogger().info(
        { app: input.app, build: input.build, advanced: changed.length > 0 },
        "Release recorded",
      );
      return latest(input.app);
    },
  };
}
export const releaseService = createReleaseService(db);
