/**
 * tRPC `portal` router (www-q002.9) , the captive-portal backend surface. The
 * frontend talks ONLY to these procedures; it never reaches UniFi. Every
 * mutation carries the device `mac` (from the UniFi external-portal redirect),
 * which is the rate-limit unit. Typed PortalErrors are mapped onto tRPC error
 * codes so the frontend can branch (wrong vs expired vs locked) without parsing
 * messages.
 *
 * The service is a module-level singleton (not per-request) because the mock
 * email sender holds the dev-readable last-code store in memory. The real
 * Resend sender (www-q002.11) slots in behind the same EmailSender interface.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { db } from "../../db/index";
import { env } from "../../env";
import { unifi } from "../../integrations/unifi";
import { createMockEmailSender } from "../../services/portal-mock-sender";
import { createDrizzlePortalRepo } from "../../services/portal-repo";
import { createResendEmailSender } from "../../services/portal-resend-sender";
import {
  createPortalService,
  type EmailSender,
  PortalError,
  PortalErrorCode,
} from "../../services/portal-service";
import { publicProcedure, router } from "../init";

// Pick the email sender: Resend when its credentials are configured, else the
// mock (dev/test readback). In PRODUCTION a missing Resend config is fatal , we
// throw rather than silently fall back to the mock, which would log codes and
// never actually email a guest (services throw; no fake-send). www-q002.11.
function resolveEmailSender(): EmailSender {
  if (env.RESEND_API_KEY && env.RESEND_FROM) {
    return createResendEmailSender({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM });
  }
  if (env.NODE_ENV === "production") {
    throw new Error(
      "Resend is not configured (RESEND_API_KEY / RESEND_FROM) , refusing to start the portal with the mock email sender in production.",
    );
  }
  return createMockEmailSender();
}

// Module-level singleton so the mock sender's in-memory code store survives
// across requests (a per-request service would lose the code between sendCode
// and the dev readback).
const portalService = createPortalService({
  repo: createDrizzlePortalRepo(db),
  sender: resolveEmailSender(),
  unifi,
  wifiPassword: env.WIFI_PASSWORD,
});

// Map a typed PortalError onto the tRPC wire. Anything else propagates as-is
// (→ 500 / GenericError on the frontend), per services-throw.
const ERROR_CODE_MAP: Record<PortalErrorCode, TRPCError["code"]> = {
  [PortalErrorCode.WrongCode]: "BAD_REQUEST",
  [PortalErrorCode.ExpiredCode]: "BAD_REQUEST",
  [PortalErrorCode.WrongPassword]: "BAD_REQUEST",
  [PortalErrorCode.RateLimited]: "TOO_MANY_REQUESTS",
  [PortalErrorCode.ResendCooldown]: "TOO_MANY_REQUESTS",
  [PortalErrorCode.NotConfigured]: "SERVICE_UNAVAILABLE",
  [PortalErrorCode.NoActiveCode]: "BAD_REQUEST",
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
  /** Create + email a 6-digit code. 30s resend cooldown enforced server-side. */
  sendCode: publicProcedure
    .input(
      z.object({
        mac: macSchema,
        name: z.string().min(1).max(200),
        email: z.string().email().max(320),
      }),
    )
    .output(z.object({ cooldownSeconds: z.number().int() }))
    .mutation(({ input }) => mapErrors(() => portalService.sendCode(input))),

  /** Verify the code. Wrong/expired/lockout map to distinct tRPC errors. */
  verifyCode: publicProcedure
    .input(z.object({ mac: macSchema, email: z.string().email().max(320), code: z.string() }))
    .output(z.object({ verified: z.literal(true), guestId: z.string() }))
    .mutation(({ input }) => mapErrors(() => portalService.verifyCode(input))),

  /** Check the WiFi password against the op-delivered secret. Lockout after 3. */
  checkPassword: publicProcedure
    .input(z.object({ mac: macSchema, password: z.string() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ input }) => mapErrors(() => portalService.checkPassword(input))),

  /** Grant the device 30 days of internet (idempotent). */
  authorize: publicProcedure
    .input(z.object({ mac: macSchema, guestId: z.string() }))
    .output(z.object({ authorized: z.literal(true) }))
    .mutation(({ input }) => mapErrors(() => portalService.authorize(input))),

  /** Device status: fresh / active (AlreadyConnected) / expired (SessionExpired). */
  status: publicProcedure
    .input(z.object({ mac: macSchema }))
    .output(z.object({ state: z.enum(["fresh", "active", "expired"]) }))
    .query(({ input }) => mapErrors(() => portalService.status(input))),

  /** Clear this device's wrong-code/password counters , the UI "back" action. */
  resetAttempts: publicProcedure
    .input(z.object({ mac: macSchema }))
    .output(z.object({ reset: z.literal(true) }))
    .mutation(({ input }) => mapErrors(() => portalService.resetAttempts(input))),
});
