import { portalRouter } from "@control-center/api/portal-router";
import { router } from "@control-center/api/trpc-init";

export const captivePortalApiRouter = router({
  portal: portalRouter,
});

export type CaptivePortalApiRouter = typeof captivePortalApiRouter;
