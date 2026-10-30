// Re-export the app's tRPC primitives so feature api.ts files import them from
// @app-kit/server, never reaching directly into apps/api.
/** @public , authoring surface consumed by feature api.ts files + the generated
 * router aggregates (features/_generated/router.gen.ts, guest-router.gen.ts). */

/** Global panel settings are owned by the API, but feature routers may read them
 * through this app-kit seam rather than importing app internals directly. */
import { db } from "../apps/api/src/db";
import { getSettings as readSettings } from "../apps/api/src/services/settings-service";
export const getSettings = () => readSettings(db);
export { mergeRouters, publicProcedure, router, TRPCError } from "../apps/api/src/trpc/init";
