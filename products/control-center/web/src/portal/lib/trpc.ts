// Typed tRPC client for the captive portal guest app. Talks ONLY to
// guestRouter.portal — the guest listener serves /trpc directly (no nginx
// rewrite in front of it; that boundary died with nginx, see ADR-0006). The
// flow drives this imperatively (reducer + effects, ../flow/effects.ts), so
// this is the vanilla client, not the React Query variant the panel uses.
import type { GuestRouter } from "@cc/api/guest";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { PortalClient } from "../flow/effects";

const PORTAL_TRPC_URL = "/trpc";

const trpc = createTRPCClient<GuestRouter>({
  links: [httpBatchLink({ url: PORTAL_TRPC_URL })],
});

/** Adapt the full tRPC client down to the PortalClient surface the effect
 *  runner needs; every call goes through portal.* (the only namespace
 *  GuestRouter exposes, ADR-0006). */
export const portalClient: PortalClient = {
  checkPassword: (input) => trpc.portal.checkPassword.mutate(input),
  authorize: (input) => trpc.portal.authorize.mutate(input),
  status: (input) => trpc.portal.status.query(input),
};
