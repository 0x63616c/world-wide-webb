import { router } from "./init";
import { portalRouter } from "./routers/portal";

// Structural security boundary (ADR-0006): unauthenticated LAN guests are
// served exactly this router, so it must expose portal.* and nothing else.
export const guestRouter = router({
  portal: portalRouter,
});

export type GuestRouter = typeof guestRouter;
