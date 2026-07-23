import { createPgIntegrationSyncStore } from "@www/core";
import { db } from "./index";

/** The prod integration-sync store: pg adapter over the api's singleton drizzle db. */
export const integrationSyncStore = createPgIntegrationSyncStore(db);
