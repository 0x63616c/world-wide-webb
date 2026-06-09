import { getLogger } from "@repo/logger";
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
const haErrorMiddleware = t.middleware(async ({ path, next }) => {
  const result = await next();
  if (!result.ok && result.error.cause instanceof HaError) {
    const haErr = result.error.cause;
    // Warn at tRPC path + original HA status so the status is not lost in the
    // remap to 503 (docs/logging.md §5 api section).
    getLogger().warn(
      { trpcPath: path, haStatus: haErr.status, haMessage: haErr.message },
      "ha error remapped to SERVICE_UNAVAILABLE",
    );
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: `Home Assistant unavailable: ${haErr.message}`,
      cause: haErr,
    });
  }
  return result;
});

export const router = t.router;
export const publicProcedure = t.procedure.use(haErrorMiddleware);
