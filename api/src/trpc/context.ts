import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { db } from "../db/index";
import type * as schema from "../db/schema";

export interface Context {
  db: NodePgDatabase<typeof schema>;
}

export function createContext(): Context {
  return { db };
}
