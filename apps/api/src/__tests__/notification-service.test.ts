/**
 * Tests for the Notification Center service. The behaviour that matters and is
 * easy to regress: dedupe-key collapse (a repeat raise must UPDATE, not insert,
 * and must resurface the row as unread), the unread badge being a global count
 * rather than a count of the returned page, and markAllRead clearing it.
 *
 * The DB is fully mocked (no Postgres), following frontend-log-service.test.ts:
 * each builder method records its argument and returns the chain, so a test can
 * assert the exact shape handed to drizzle. The job queue is mocked too , the
 * real enqueueJob writes through the module-singleton db.
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as schema from "../db/schema";

const queueMock = vi.hoisted(() => ({
  enqueued: [] as Array<{ type: string; payload: unknown }>,
}));
vi.mock("../jobs/queue", () => ({
  enqueueJob: vi.fn(async (type: string, payload: unknown) => {
    queueMock.enqueued.push({ type, payload });
    return 1;
  }),
}));

// The service imports the singleton db (only the job handler uses it); stub it
// so importing the module never opens a connection.
vi.mock("../db/index", () => ({ db: {} }));

import {
  countUnread,
  listNotifications,
  markAllRead,
  markRead,
  newNotificationId,
  raiseNotification,
  registerPushToken,
} from "../services/notification-service";
import { appRouter } from "../trpc/routers/index";

type Db = NodePgDatabase<typeof schema>;

/** A notification row as the DB would return it. */
function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "notif_deadbeef",
    createdAt: new Date("2026-07-18T10:00:00Z"),
    category: "ci",
    severity: "warning",
    title: "Deploy failed",
    body: null,
    deepLink: null,
    data: null,
    readAt: null,
    dedupeKey: null,
    ...over,
  };
}

/**
 * Mock db recording every builder call.
 *
 * Drizzle chains are awaitable at any point, so the mock's chain objects ARE
 * promises with the builder methods attached (rather than hand-rolled `then`
 * properties, which biome bans). The two select shapes are told apart by
 * terminator, not by call order: a feed read ends in `.limit()` and resolves
 * `listRows`, while a count read is awaited directly off `.where()` and
 * resolves `countRows`.
 */
function makeDb(listRows: unknown[] = [], countRows: unknown[] = []) {
  const calls = {
    insertValues: [] as unknown[],
    onConflictDoUpdate: [] as unknown[],
    updateSets: [] as unknown[],
    deletes: 0,
  };
  let returningRows: unknown[] = [row()];

  const selectChain = () => {
    const chain = Object.assign(Promise.resolve(countRows), {
      limit: () => Promise.resolve(listRows),
    }) as unknown as Promise<unknown[]> & Record<string, unknown>;
    for (const m of ["from", "where", "orderBy"]) chain[m] = () => chain;
    return chain;
  };

  const db = {
    select: () => selectChain(),
    insert: () => ({
      values: (v: unknown) => {
        calls.insertValues.push(v);
        return Object.assign(Promise.resolve(undefined), {
          onConflictDoUpdate: (cfg: unknown) => {
            calls.onConflictDoUpdate.push(cfg);
            return Object.assign(Promise.resolve(undefined), {
              returning: () => Promise.resolve(returningRows),
            });
          },
          returning: () => Promise.resolve(returningRows),
        });
      },
    }),
    update: () => ({
      set: (s: unknown) => {
        calls.updateSets.push(s);
        return { where: () => Promise.resolve(undefined) };
      },
    }),
    delete: () => {
      calls.deletes++;
      return { where: () => Promise.resolve(undefined) };
    },
  } as unknown as Db;

  return {
    db,
    calls,
    setReturning: (rows: unknown[]) => {
      returningRows = rows;
    },
  };
}

beforeEach(() => {
  queueMock.enqueued.length = 0;
});

// ─── ids ─────────────────────────────────────────────────────────────────────

describe("newNotificationId", () => {
  it("mints a Stripe-style notif_<8hex> id", () => {
    expect(newNotificationId()).toMatch(/^notif_[0-9a-f]{8}$/);
  });

  it("does not collide across calls", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newNotificationId()));
    expect(ids.size).toBe(200);
  });
});

// ─── dedupe collapse ─────────────────────────────────────────────────────────

describe("raiseNotification dedupe", () => {
  it("collapses a keyed raise onto the existing row via onConflictDoUpdate", async () => {
    const { db, calls, setReturning } = makeDb();
    setReturning([row({ dedupeKey: "ci:deploy-failed" })]);

    await raiseNotification(db, {
      category: "ci",
      severity: "warning",
      title: "Deploy failed",
      dedupeKey: "ci:deploy-failed",
    });

    expect(calls.onConflictDoUpdate).toHaveLength(1);
    const cfg = calls.onConflictDoUpdate[0] as { set: Record<string, unknown> };
    // The repeat is news again: the collapse must clear readAt, otherwise a
    // recurring failure the user read once stays invisible.
    expect(cfg.set.readAt).toBeNull();
    expect(cfg.set.createdAt).toBeInstanceOf(Date);
  });

  it("does NOT upsert when no dedupeKey is given (every raise is distinct)", async () => {
    const { db, calls } = makeDb();

    await raiseNotification(db, { category: "home", severity: "info", title: "Door unlocked" });

    expect(calls.onConflictDoUpdate).toHaveLength(0);
    expect(calls.insertValues).toHaveLength(1);
    expect((calls.insertValues[0] as { dedupeKey: unknown }).dedupeKey).toBeNull();
  });

  it("enqueues exactly one notify job per raise", async () => {
    const { db } = makeDb();
    await raiseNotification(db, { category: "system", severity: "critical", title: "Disk full" });
    expect(queueMock.enqueued).toEqual([
      { type: "notify", payload: { notificationId: "notif_deadbeef" } },
    ]);
  });

  it("skips the upsert + notify job when a re-raise repeats an unread row's content unchanged", async () => {
    const existing = row({
      category: "system",
      severity: "info",
      dedupeKey: "app-update:2 builds behind",
      title: "Update available",
      body: "1.0 (68) · 2 builds behind",
    });
    const { db, calls } = makeDb([existing]);

    const item = await raiseNotification(db, {
      category: "system",
      severity: "info",
      title: "Update available",
      body: "1.0 (68) · 2 builds behind",
      dedupeKey: "app-update:2 builds behind",
    });

    expect(calls.insertValues).toHaveLength(0);
    expect(calls.onConflictDoUpdate).toHaveLength(0);
    expect(queueMock.enqueued).toHaveLength(0);
    expect(item.id).toBe(existing.id);
  });

  it("still re-raises when the repeated dedupeKey's content actually changed", async () => {
    const existing = row({
      dedupeKey: "app-update",
      title: "Update available",
      body: "1.0 (68) · 2 builds behind",
    });
    const { db, calls, setReturning } = makeDb([existing]);
    setReturning([row({ dedupeKey: "app-update", body: "1.0 (69) · 3 builds behind" })]);

    await raiseNotification(db, {
      category: "system",
      severity: "info",
      title: "Update available",
      body: "1.0 (69) · 3 builds behind",
      dedupeKey: "app-update",
    });

    expect(calls.onConflictDoUpdate).toHaveLength(1);
    expect(queueMock.enqueued).toHaveLength(1);
  });

  it("returns the persisted row as an ISO-stamped wire item", async () => {
    const { db } = makeDb();
    const item = await raiseNotification(db, {
      category: "ci",
      severity: "warning",
      title: "Deploy failed",
    });
    expect(item.createdAt).toBe("2026-07-18T10:00:00.000Z");
    expect(item.readAt).toBeNull();
  });
});

// ─── feed + unread count ─────────────────────────────────────────────────────

describe("listNotifications", () => {
  it("returns items plus the GLOBAL unread count, not the page size", async () => {
    // One item on the page, but seven unread overall.
    const { db } = makeDb([row()], [{ count: 7 }]);

    const res = await listNotifications(db, { filter: "all", limit: 50 });

    expect(res.items).toHaveLength(1);
    expect(res.unreadCount).toBe(7);
  });

  it("serves read rows on the All tab without disturbing the unread badge", async () => {
    const { db } = makeDb([row({ readAt: new Date("2026-07-18T11:00:00Z") })], [{ count: 4 }]);
    const res = await listNotifications(db, { filter: "all", limit: 50 });
    expect(res.items[0]?.readAt).toBe("2026-07-18T11:00:00.000Z");
    // The badge is the global unread total, not a property of the view.
    expect(res.unreadCount).toBe(4);
  });

  it("reports zero unread when the count query returns no rows", async () => {
    const { db } = makeDb([], []);
    const res = await listNotifications(db, { filter: "unread", limit: 50 });
    expect(res.items).toEqual([]);
    expect(res.unreadCount).toBe(0);
  });
});

describe("countUnread", () => {
  it("reads the ::int-cast count", async () => {
    const { db } = makeDb([], [{ count: 3 }]);
    expect(await countUnread(db)).toBe(3);
  });
});

// ─── read lifecycle ──────────────────────────────────────────────────────────

describe("markRead / markAllRead", () => {
  it("markRead stamps readAt and returns the fresh count", async () => {
    const { db, calls } = makeDb([], [{ count: 2 }]);
    const res = await markRead(db, "notif_deadbeef");
    expect((calls.updateSets[0] as { readAt: unknown }).readAt).toBeInstanceOf(Date);
    expect(res.unreadCount).toBe(2);
  });

  it("markAllRead clears the badge to zero", async () => {
    const { db, calls } = makeDb([], [{ count: 0 }]);
    const res = await markAllRead(db);
    expect(calls.updateSets).toHaveLength(1);
    expect((calls.updateSets[0] as { readAt: unknown }).readAt).toBeInstanceOf(Date);
    expect(res.unreadCount).toBe(0);
  });
});

// ─── push token registration ─────────────────────────────────────────────────

describe("registerPushToken", () => {
  it("upserts on deviceId so a rotated token replaces the old row", async () => {
    const { db, calls } = makeDb();
    await registerPushToken(db, {
      deviceId: "ipad13-1-3f9a2c1b",
      token: "abc123",
      platform: "ios",
      deviceName: "Wall Panel",
      pushEnabled: true,
    });
    expect(calls.onConflictDoUpdate).toHaveLength(1);
    const cfg = calls.onConflictDoUpdate[0] as { set: Record<string, unknown> };
    expect(cfg.set.token).toBe("abc123");
  });
});

// ─── router wiring ───────────────────────────────────────────────────────────

describe("notifications router", () => {
  it("exposes the full procedure surface the panel depends on", () => {
    const procs = Object.keys(appRouter._def.procedures).filter((k) =>
      k.startsWith("notifications."),
    );
    expect(procs.sort()).toEqual(
      [
        "notifications.list",
        "notifications.markAllRead",
        "notifications.markRead",
        "notifications.raise",
        "notifications.registerToken",
      ].sort(),
    );
  });
});
