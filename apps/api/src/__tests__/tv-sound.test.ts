import { describe, expect, it } from "vitest";
import { appRouter } from "../trpc/routers";

// Verifies the media split (Track C fold): the standalone 'media' router
// was replaced by 'tv' (features/tv) and 'sound' (features/sound), each
// registered on the app router and typechecking.

describe("tv and sound router registration", () => {
  it("exposes 'tv' and 'sound' as named sub-routers on the app router", () => {
    // tRPC stores nested routers in _def.record; an empty skeleton router
    // registers under its key there before any procedures are added.
    const record = (appRouter._def as unknown as Record<string, unknown>).record as Record<
      string,
      unknown
    >;
    expect(Object.keys(record)).toContain("tv");
    expect(Object.keys(record)).toContain("sound");
  });
});
