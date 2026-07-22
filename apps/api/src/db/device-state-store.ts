import { createPgDeviceStateStore } from "@www/core";
import { db } from "./index";

/** The prod device-state store: pg adapter over the api's singleton drizzle db. */
export const deviceStateStore = createPgDeviceStateStore(db);
