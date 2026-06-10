/**
 * Router-wiring test for the portal router (www-q002.9). The full behavioural
 * matrix (send/verify/check/status/authorize, lockouts, expiry, idempotency)
 * lives in portal-service.test.ts. The PortalError→tRPC code map is exhaustive
 * by construction (a `Record<PortalErrorCode, TRPCError["code"]>` — the compiler
 * rejects an unmapped state). Here we only assert the router is registered with
 * every procedure the frontend calls.
 */
import { describe, expect, it } from "vitest";
import { appRouter } from "../trpc/routers/index";

describe("portal router wiring", () => {
  it("registers all five procedures on the appRouter", () => {
    const names = Object.keys(appRouter._def.procedures).filter((k) => k.startsWith("portal."));
    expect(names).toEqual(
      expect.arrayContaining([
        "portal.sendCode",
        "portal.verifyCode",
        "portal.checkPassword",
        "portal.authorize",
        "portal.status",
      ]),
    );
  });
});
