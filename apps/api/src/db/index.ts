import { createPool } from "@www/core";
import { drizzle } from "drizzle-orm/node-postgres";

import { env } from "../env";
import * as schema from "./schema";

export const pool = createPool(env.DATABASE_URL);
export const db = drizzle(pool, { schema });
