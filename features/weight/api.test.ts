/**
 * weight.delete against a mocked db — no Postgres needed. Verifies the
 * tombstone mutation reports the truth: NOT_FOUND on a row that doesn't
 * exist (or is already deleted), success only when a row actually flipped.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDbUpdate } = vi.hoisted(() => ({
  mockDbUpdate: vi.fn(),
}));

vi.mock("./db", () => ({
  db: { update: mockDbUpdate },
}));

import { router } from "@app-kit/server";
import type { TRPCError } from "@trpc/server";
import { weightRouter } from "./api";

function buildCaller() {
  const appRouter = router({ weight: weightRouter });
  // @ts-expect-error - db not needed by weight procedures (they use this feature's own db)
  return appRouter.createCaller({ db: null });
}

// Chainable update mock for db.update().set().where().returning().
function mockReturning(rows: unknown[]): void {
  mockDbUpdate.mockImplementation(() => ({
    set: () => ({
      where: () => ({
        returning: () => Promise.resolve(rows),
      }),
    }),
  }));
}

describe("weightRouter.delete", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns ok:true when a row is actually tombstoned", async () => {
    mockReturning([{ id: "wm_1" }]);
    const caller = buildCaller();
    await expect(caller.weight.delete({ id: "wm_1" })).resolves.toEqual({ ok: true });
  });

  it("throws NOT_FOUND rather than reporting success for a nonexistent row", async () => {
    mockReturning([]);
    const caller = buildCaller();
    await expect(caller.weight.delete({ id: "wm_missing" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    } satisfies Partial<TRPCError>);
  });
});
