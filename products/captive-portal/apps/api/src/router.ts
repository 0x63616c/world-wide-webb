import { portalRouter } from "@repo/api/portal-router";
import { router } from "@repo/api/trpc-init";

export const captivePortalApiRouter = router({
  portal: portalRouter,
});

export type CaptivePortalApiRouter = typeof captivePortalApiRouter;
