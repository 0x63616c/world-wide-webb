// Typed tRPC client for the captive portal. Talks ONLY to appRouter.portal via
// the scoped nginx proxy: base /api/trpc, which nginx rewrites
// /api/trpc/portal.X -> /trpc/portal.X (infra CC-q002.2 contract). Same-origin
// in production; the dev server proxies it. The flow drives this imperatively
// (reducer + effects, src/flow/effects.ts), so this is the vanilla client, not
// the React Query variant.
import type { AppRouter } from "@cc/api/trpc";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { PortalClient } from "@/flow/effects";

/** httpBatchLink base. NOT /trpc (the dashboard's path), /api/trpc is the
 *  portal's scoped boundary; nginx 404s every other /api path. */
const PORTAL_TRPC_URL = "/api/trpc";

const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: PORTAL_TRPC_URL })],
});

/** Adapt the full tRPC client down to the PortalClient surface the effect
 *  runner needs, every call goes through portal.* (the only procedures the
 *  nginx allowlist passes; batches stay under /api/trpc/portal.*). */
export const portalClient: PortalClient = {
  sendCode: (input) => trpc.portal.sendCode.mutate(input),
  verifyCode: (input) => trpc.portal.verifyCode.mutate(input),
  checkPassword: (input) => trpc.portal.checkPassword.mutate(input),
  authorize: (input) => trpc.portal.authorize.mutate(input),
  status: (input) => trpc.portal.status.query(input),
  resetAttempts: (input) => trpc.portal.resetAttempts.mutate(input),
};
