/**
 * tRPC `portal` facet (www-q002.9, password-only since www-p9hx) , the
 * captive-portal backend surface, folded into the guest-wifi feature (Track C,
 * C7). The frontend talks ONLY to these procedures; it never reaches UniFi.
 * Every call carries the device `mac` (from the UniFi external-portal redirect).
 * There is no email/OTP: the guest types one shared WiFi password. Typed
 * PortalErrors map onto tRPC error codes so the frontend can branch (wrong vs
 * rate-limited) without parsing messages.
 *
 * The feature owns its wiring: it builds its own db handle (./db) and UniFi
 * client from its own config slice (./config), and reaches the tRPC runtime
 * ONLY through `@app-kit/server` (the single sanctioned seam into apps/api's
 * trpc/init — never a direct apps/api import). The codegen collects the exported
 * `api` facet's top-level router keys into the generated app + guest routers.
 */
import { defineApi } from "@app-kit";
import { publicProcedure, router } from "@app-kit/server";
import { TRPCError } from "@trpc/server";
import { createUnifiClient } from "@www/core";
import { z } from "zod";
import { config } from "./config";
import { db } from "./db";
import { createDrizzlePortalRepo } from "./repo";
import { createPortalService, PortalError, PortalErrorCode } from "./service";

// The feature's own UniFi client, built from its config slice (D1) rather than
// apps/api's env-aware singleton.
const unifi = createUnifiClient({
  apiKey: config.UNIFI_API_KEY,
  baseUrl: config.UNIFI_CONTROLLER_URL,
  siteId: config.UNIFI_SITE_ID,
});

// Module-level singleton: a stateless password-only service wired to the real
// drizzle repo + UniFi adapter.
const portalService = createPortalService({
  repo: createDrizzlePortalRepo(db),
  unifi,
  wifiPassword: config.WIFI_PASSWORD,
});

// Map a typed PortalError onto the tRPC wire. Anything else propagates as-is
// (→ 500 / GenericError on the frontend), per services-throw.
const ERROR_CODE_MAP: Record<PortalErrorCode, TRPCError["code"]> = {
  [PortalErrorCode.WrongPassword]: "BAD_REQUEST",
  [PortalErrorCode.RateLimited]: "TOO_MANY_REQUESTS",
  [PortalErrorCode.NotConfigured]: "SERVICE_UNAVAILABLE",
};

async function mapErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PortalError) {
      throw new TRPCError({
        code: ERROR_CODE_MAP[err.code],
        // The typed code rides in the message tail so the frontend can branch
        // on the exact portal state without a custom error-shape contract.
        message: `${err.code}: ${err.message}`,
        cause: err,
      });
    }
    throw err;
  }
}

// A MAC address as carried by the UniFi redirect (colon- or hyphen-separated,
// any case). Kept permissive , normalisation happens server-side.
const macSchema = z
  .string()
  .min(12)
  .max(17)
  .regex(/^[0-9a-fA-F]{2}([:-][0-9a-fA-F]{2}){5}$/, "invalid MAC address");

const portalRouter = router({
  /** Check the WiFi password against the op-delivered secret. Global daily limit. */
  checkPassword: publicProcedure
    .input(z.object({ mac: macSchema, password: z.string() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ input }) => mapErrors(() => portalService.checkPassword(input))),

  /**
   * Grant the device 30 days of internet (idempotent, keyed by MAC). Re-verifies
   * the password server-side (same check + rate limit as checkPassword) so a
   * guest-SSID device can't call this directly without ever passing the gate.
   */
  authorize: publicProcedure
    .input(z.object({ mac: macSchema, password: z.string() }))
    .output(z.object({ authorized: z.literal(true) }))
    .mutation(({ input }) => mapErrors(() => portalService.authorize(input))),

  /** Device status: fresh / active (AlreadyConnected) / expired (SessionExpired). */
  status: publicProcedure
    .input(z.object({ mac: macSchema }))
    .output(z.object({ state: z.enum(["fresh", "active", "expired"]) }))
    .query(({ input }) => mapErrors(() => portalService.status(input))),
});

/**
 * The branded `api` facet. Its single top-level key `portal` is the router
 * namespace the generated app-router + guest-router mount (guest surface =
 * portal only, ADR-0006). The codegen reads these keys off `api._def.record`.
 */
export const api = defineApi(router({ portal: portalRouter }));
