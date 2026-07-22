/**
 * tRPC `portal` router (www-q002.9, password-only since www-p9hx) , the
 * captive-portal backend surface. The frontend talks ONLY to these procedures;
 * it never reaches UniFi. Every call carries the device `mac` (from the UniFi
 * external-portal redirect). There is no email/OTP: the guest types one shared
 * WiFi password (Apple's CNA can't reach Mail pre-auth, so an emailed code is
 * unusable). Typed PortalErrors map onto tRPC error codes so the frontend can
 * branch (wrong vs rate-limited) without parsing messages.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { db } from "../../db/index";
import { env } from "../../env";
import { unifi } from "../../integrations/unifi";
import { createDrizzlePortalRepo } from "../../services/portal-repo";
import { createPortalService, PortalError, PortalErrorCode } from "../../services/portal-service";
import { publicProcedure, router } from "../init";

// Module-level singleton: a stateless password-only service wired to the real
// drizzle repo + UniFi adapter.
const portalService = createPortalService({
  repo: createDrizzlePortalRepo(db),
  unifi,
  wifiPassword: env.WIFI_PASSWORD,
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

export const portalRouter = router({
  /** Check the WiFi password against the op-delivered secret. Global daily limit. */
  checkPassword: publicProcedure
    .input(z.object({ mac: macSchema, password: z.string() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ input }) => mapErrors(() => portalService.checkPassword(input))),

  /** Grant the device 30 days of internet (idempotent, keyed by MAC). */
  authorize: publicProcedure
    .input(z.object({ mac: macSchema }))
    .output(z.object({ authorized: z.literal(true) }))
    .mutation(({ input }) => mapErrors(() => portalService.authorize(input))),

  /** Device status: fresh / active (AlreadyConnected) / expired (SessionExpired). */
  status: publicProcedure
    .input(z.object({ mac: macSchema }))
    .output(z.object({ state: z.enum(["fresh", "active", "expired"]) }))
    .query(({ input }) => mapErrors(() => portalService.status(input))),
});
