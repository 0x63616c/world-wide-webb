import { describe, expect, it } from "vitest";
import { appRouter } from "../trpc/routers";

// Verifies A1: the media router is registered on the app router and typechecks.

describe("media router registration", () => {
  it("exposes 'media' as a named sub-router on the app router", () => {
    // tRPC stores nested routers in _def.record; an empty skeleton router
    // registers under its key there before any procedures are added.
    const record = (appRouter._def as unknown as Record<string, unknown>).record as Record<
      string,
      unknown
    >;
    expect(Object.keys(record)).toContain("media");
  });
});
