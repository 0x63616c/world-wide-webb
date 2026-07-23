// Re-export the app's tRPC primitives so feature api.ts files import them from
// @app-kit/server, never reaching directly into apps/api.
/** @public , authoring surface consumed by feature api.ts files + the generated
 * router aggregates (features/_generated/router.gen.ts, guest-router.gen.ts). */
export { mergeRouters, publicProcedure, router } from "../apps/api/src/trpc/init";
