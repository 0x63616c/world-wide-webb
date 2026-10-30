import { createFeatureDb } from "@www/core";
import { ENV } from "@www/platform/env";
import * as schema from "./schema";

export const db = createFeatureDb(ENV.DATABASE_URL, schema);
