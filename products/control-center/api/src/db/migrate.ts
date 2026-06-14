import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getLogger } from "@repo/logger";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./index";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations() {
  const folder = resolve(__dirname, "./migrations");
  const log = getLogger();
  log.info({ folder }, "migrations start");
  await migrate(db, { migrationsFolder: folder });
  log.info({ folder }, "migrations done");
}
