/**
 * Router-wiring test for the photo booth router. The behavioural matrix (save,
 * grouped listing, soft delete) lives in booth-photo-service.test.ts; here we
 * only assert the router is registered on the appRouter with the two procedures
 * the gallery calls.
 */
import { describe, expect, it } from "vitest";
import { appRouter } from "../trpc/routers/index";

describe("booth photos router wiring", () => {
  it("registers list + remove on the appRouter", () => {
    const names = Object.keys(appRouter._def.procedures).filter((k) =>
      k.startsWith("boothPhotos."),
    );
    expect(names).toEqual(expect.arrayContaining(["boothPhotos.list", "boothPhotos.remove"]));
  });
});
