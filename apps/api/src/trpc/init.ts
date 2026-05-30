import { initTRPC, TRPCError } from "@trpc/server";

import { HaError } from "../integrations/homeassistant/types";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create();

/**
 * Maps Home Assistant outages onto tRPC's standard error channel: the client
 * gets a 503 SERVICE_UNAVAILABLE with a structured cause instead of a 500.
 * Individual services should still catch HaError and return last-known /
 * placeholder data so tiles never render blank; this is the backstop.
 */
const haErrorMiddleware = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok && result.error.cause instanceof HaError) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: `Home Assistant unavailable: ${result.error.cause.message}`,
      cause: result.error.cause,
    });
  }
  return result;
});

export const router = t.router;
export const publicProcedure = t.procedure.use(haErrorMiddleware);
