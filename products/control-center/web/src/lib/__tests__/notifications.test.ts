import { describe, expect, it } from "vitest";
import {
  applyMutes,
  isDismissed,
  isUnread,
  type NotificationItem,
  notificationAge,
  parseMutedCategories,
  serializeMutedCategories,
  sortNewestFirst,
  tileRows,
  toggleMutedCategory,
  unreadBadge,
} from "../notifications";

const NOW = Date.parse("2026-07-18T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function item(over: Partial<NotificationItem> & { id: string }): NotificationItem {
  return {
    createdAt: minutesAgo(5),
    category: "system",
    severity: "info",
    title: "Something happened",
    ...over,
  };
}

describe("read/dismissed predicates", () => {
  it("treats a row with neither timestamp as unread", () => {
    expect(isUnread(item({ id: "a" }))).toBe(true);
  });

  it("treats a read row as read", () => {
    expect(isUnread(item({ id: "a", readAt: minutesAgo(1) }))).toBe(false);
  });

  it("treats a dismissed-but-never-read row as read, not unread", () => {
    // Dismissing IS an acknowledgement , a dismissed row must never keep
    // inflating the unread count.
    const dismissed = item({ id: "a", dismissedAt: minutesAgo(1) });
    expect(isUnread(dismissed)).toBe(false);
    expect(isDismissed(dismissed)).toBe(true);
  });

  it("accepts explicit nulls from the server as 'not yet'", () => {
    expect(isUnread(item({ id: "a", readAt: null, dismissedAt: null }))).toBe(true);
  });
});

describe("sortNewestFirst", () => {
  it("orders newest first", () => {
    const sorted = sortNewestFirst([
      item({ id: "old", createdAt: minutesAgo(60) }),
      item({ id: "new", createdAt: minutesAgo(1) }),
      item({ id: "mid", createdAt: minutesAgo(30) }),
    ]);
    expect(sorted.map((n) => n.id)).toEqual(["new", "mid", "old"]);
  });

  it("does not mutate the input (it is React Query cache state)", () => {
    const input = [item({ id: "old", createdAt: minutesAgo(60) }), item({ id: "new" })];
    const before = input.map((n) => n.id);
    sortNewestFirst(input);
    expect(input.map((n) => n.id)).toEqual(before);
  });

  it("sorts an unparseable timestamp last rather than throwing", () => {
    const sorted = sortNewestFirst([
      item({ id: "junk", createdAt: "not-a-date" }),
      item({ id: "ok" }),
    ]);
    expect(sorted.map((n) => n.id)).toEqual(["ok", "junk"]);
  });
});

describe("applyMutes", () => {
  it("returns everything when nothing is muted", () => {
    const items = [item({ id: "a", category: "ci" }), item({ id: "b", category: "home" })];
    expect(applyMutes(items, [])).toHaveLength(2);
  });

  it("drops only the muted categories", () => {
    const items = [
      item({ id: "a", category: "ci" }),
      item({ id: "b", category: "home" }),
      item({ id: "c", category: "media" }),
    ];
    expect(applyMutes(items, ["ci", "media"]).map((n) => n.id)).toEqual(["b"]);
  });
});

describe("tileRows", () => {
  it("takes the newest unread, mute-filtered, capped to the limit", () => {
    const items = [
      item({ id: "read", createdAt: minutesAgo(1), readAt: minutesAgo(1) }),
      item({ id: "muted", createdAt: minutesAgo(2), category: "ci" }),
      item({ id: "n1", createdAt: minutesAgo(3) }),
      item({ id: "n2", createdAt: minutesAgo(4) }),
      item({ id: "n3", createdAt: minutesAgo(5) }),
      item({ id: "n4", createdAt: minutesAgo(6) }),
    ];
    expect(tileRows(items, ["ci"], 3).map((n) => n.id)).toEqual(["n1", "n2", "n3"]);
  });

  it("is empty when everything is read", () => {
    expect(tileRows([item({ id: "a", readAt: minutesAgo(1) })], [])).toEqual([]);
  });
});

describe("notificationAge", () => {
  it("formats a recent row in minutes", () => {
    expect(notificationAge(minutesAgo(3), NOW)).toBe("3mins");
  });

  it("formats an hour-old row in hours", () => {
    expect(notificationAge(minutesAgo(90), NOW)).toBe("1hr");
  });

  it("returns 'now' for a future timestamp rather than a negative age", () => {
    expect(notificationAge(new Date(NOW + 60_000).toISOString(), NOW)).toBe("now");
  });

  it("returns 'now' for an unparseable timestamp rather than throwing", () => {
    expect(notificationAge("not-a-date", NOW)).toBe("now");
  });
});

describe("unreadBadge", () => {
  it("renders a plain count", () => {
    expect(unreadBadge(7)).toBe("7");
  });

  it("caps at 99+ so the pill can't grow the tile header", () => {
    expect(unreadBadge(100)).toBe("99+");
    expect(unreadBadge(99)).toBe("99");
  });

  it("never renders a negative count", () => {
    expect(unreadBadge(-1)).toBe("0");
  });
});

describe("muted-category codec", () => {
  it("round-trips a set", () => {
    expect(parseMutedCategories(serializeMutedCategories(["media", "ci"]))).toEqual([
      "ci",
      "media",
    ]);
  });

  it("drops unknown and blank entries from storage", () => {
    expect(parseMutedCategories("ci, ,bogus,media")).toEqual(["ci", "media"]);
  });

  it("parses an empty string as nothing muted", () => {
    expect(parseMutedCategories("")).toEqual([]);
  });

  it("serializes in canonical order regardless of input order", () => {
    expect(serializeMutedCategories(["media", "system", "ci"])).toBe("ci,system,media");
  });

  it("dedupes", () => {
    expect(serializeMutedCategories(["ci", "ci"])).toBe("ci");
  });

  it("toggles a category on and back off", () => {
    const on = toggleMutedCategory("", "home", true);
    expect(parseMutedCategories(on)).toEqual(["home"]);
    expect(toggleMutedCategory(on, "home", false)).toBe("");
  });

  it("unmuting something already unmuted is a no-op", () => {
    expect(toggleMutedCategory("ci", "home", false)).toBe("ci");
  });
});
