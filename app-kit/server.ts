// Re-export the app's tRPC primitives so feature api.ts files import them from
// @app-kit/server, never reaching directly into apps/api.
export { publicProcedure, router } from "../apps/api/src/trpc/init";
