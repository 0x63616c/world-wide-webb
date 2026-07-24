import { createPool } from "@www/core";
import { ENV as config } from "@www/platform/env";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export const pool = createPool(config.DATABASE_URL);
export const db = drizzle(pool, { schema });
