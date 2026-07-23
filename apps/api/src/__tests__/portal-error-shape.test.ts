/**
 * The portal error shape (www-q002.19). A thrown PortalError must surface its
 * typed code STRUCTURALLY as `error.data.portalCode` on the tRPC wire, so the
 * frontend branches on the enum, not on parsing the human message string. The
 * message keeps its "CODE: text" prefix for logs/back-compat.
 */

import { PortalError, PortalErrorCode } from "@features/guest-wifi/service";
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { appRouter } from "../trpc/routers/index";

// The configured errorFormatter the HTTP layer runs via getErrorShape.
const formatter = appRouter._def._config.errorFormatter;

function shapeFor(cause: unknown) {
  const error = new TRPCError({ code: "BAD_REQUEST", message: "x", cause });
  return formatter({
    error,
    type: "mutation" as const,
    path: "portal.checkPassword",
    input: undefined,
    ctx: undefined,
    shape: {
      message: error.message,
      code: -32600,
      data: { code: "BAD_REQUEST", httpStatus: 400 },
    },
  });
}

describe("portal error shape (www-q002.19)", () => {
  it("surfaces portalCode in error.data when the cause is a PortalError", () => {
    const shape = shapeFor(new PortalError(PortalErrorCode.WrongPassword, "nope"));
    expect((shape.data as { portalCode?: string }).portalCode).toBe(PortalErrorCode.WrongPassword);
  });

  it("surfaces RATE_LIMITED for a lockout PortalError", () => {
    const shape = shapeFor(new PortalError(PortalErrorCode.RateLimited, "locked"));
    expect((shape.data as { portalCode?: string }).portalCode).toBe(PortalErrorCode.RateLimited);
  });

  it("does NOT add portalCode for a non-PortalError cause", () => {
    const shape = shapeFor(new Error("plain"));
    expect((shape.data as { portalCode?: string }).portalCode).toBeUndefined();
  });

  it("leaves the default shape fields intact (code/httpStatus still present)", () => {
    const shape = shapeFor(new PortalError(PortalErrorCode.NotConfigured, "unconfigured"));
    const data = shape.data as { code?: string; httpStatus?: number; portalCode?: string };
    expect(data.code).toBe("BAD_REQUEST");
    expect(data.httpStatus).toBe(400);
    expect(data.portalCode).toBe(PortalErrorCode.NotConfigured);
  });
});
