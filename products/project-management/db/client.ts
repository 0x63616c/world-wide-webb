import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { schema } from "./schema";

export function projectManagementDatabaseUrl(): string {
  const url = Bun.env.PROJECT_MANAGEMENT_DATABASE_URL;
  if (!url) throw new Error("PROJECT_MANAGEMENT_DATABASE_URL is required");
  return url;
}

export function createProjectManagementPool(
  connectionString = projectManagementDatabaseUrl(),
): Pool {
  return new Pool({ connectionString });
}

export function createProjectManagementDb(pool = createProjectManagementPool()) {
  return drizzle(pool, { schema });
}
