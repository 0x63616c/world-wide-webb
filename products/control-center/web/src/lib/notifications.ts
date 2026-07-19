/**
 * Notification Center , the pure domain vocabulary shared by the tile, the
 * expanded panel, the settings page, and the banner bridge.
 *
 * Everything here is a pure function or a constant table: no React, no tRPC, no
 * DOM. The shapes mirror the `notifications` tRPC router's I/O verbatim, so a
 * container hands a server row straight to a view with no adapting layer, and
 * the ordering/grouping/mute rules can be unit-tested without rendering.
 *
 * The server is authoritative for WHICH rows exist (it owns the `filter`
 * argument); this module owns how they are ordered, labelled, coloured, and
 * which ones the user has muted locally.
 */

import { formatRelativeAge } from "./relative-age";

// ─── vocabulary (mirrors the router's zod enums) ──────────────────────────────

export const NOTIFICATION_CATEGORIES = ["ci", "system", "home", "media"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_SEVERITIES = ["info", "warning", "critical"] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

/** The three tabs the expanded panel offers, matching `notifications.list` input. */
export const NOTIFICATION_FILTERS = ["unread", "all", "dismissed"] as const;
export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

/**
 * One persisted notification row. `readAt`/`dismissedAt` are nullable rather
 * than optional-only because the server sends explicit nulls for "not yet"; both
 * spellings are accepted so a view never has to distinguish them.
 */
export interface NotificationItem {
  id: string;
  /** ISO-8601 creation timestamp, as sent by the server. */
  createdAt: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  body?: string | null;
  deepLink?: string | null;
  data?: unknown;
  readAt?: string | null;
  dismissedAt?: string | null;
}

// ─── display tables ───────────────────────────────────────────────────────────

/**
 * Severity → board palette colour. Reuses the same three tones the existing
 * banners already use (green/amber/red), so a critical notification in the
 * center reads as the same urgency as the banner that raised it.
 */
export const SEVERITY_COLOR: Record<NotificationSeverity, string> = {
  info: "var(--acc, #7ac48f)",
  warning: "var(--amber, #f4c063)",
  critical: "var(--red, #e5484d)",
};

/** Human label for a category chip. "CI" is an initialism, hence not title-case. */
export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  ci: "CI",
  system: "System",
  home: "Home",
  media: "Media",
};

/** Empty-state copy per tab , distinct per filter so "nothing here" says why. */
export const EMPTY_COPY: Record<NotificationFilter, { title: string; sub: string }> = {
  unread: { title: "All caught up", sub: "New alerts land here as they're raised." },
  all: { title: "No notifications yet", sub: "Nothing has been raised on this panel." },
  dismissed: { title: "Nothing dismissed", sub: "Notifications you dismiss are kept here." },
};

// ─── predicates + ordering ────────────────────────────────────────────────────

/** A row is unread while it has no `readAt` AND has not been dismissed. */
export function isUnread(n: NotificationItem): boolean {
  return !n.readAt && !n.dismissedAt;
}

export function isDismissed(n: NotificationItem): boolean {
  return Boolean(n.dismissedAt);
}

/** Epoch ms for a row's `createdAt`; NaN-safe (unparseable sorts oldest). */
function createdAtMs(n: NotificationItem): number {
  const t = new Date(n.createdAt).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Newest-first, the only order the center ever shows. Returns a new array , the
 * server response is React Query cache state and must not be sorted in place.
 */
export function sortNewestFirst(items: readonly NotificationItem[]): NotificationItem[] {
  return [...items].sort((a, b) => createdAtMs(b) - createdAtMs(a));
}

/**
 * Drop rows whose category the user has muted. Applied CLIENT-side and only to
 * what is displayed: muting is a per-panel preference, so the row still exists
 * on the server (and still counts on an unmuted panel) , muting hides noise, it
 * does not delete history.
 */
export function applyMutes(
  items: readonly NotificationItem[],
  muted: readonly NotificationCategory[],
): NotificationItem[] {
  if (muted.length === 0) return [...items];
  const hidden = new Set(muted);
  return items.filter((n) => !hidden.has(n.category));
}

/**
 * The rows the tile shows: unread, unmuted, newest-first, capped. The cap is a
 * display concern (a 4x3 tile fits about three dense rows), not a fetch concern.
 */
export function tileRows(
  items: readonly NotificationItem[],
  muted: readonly NotificationCategory[],
  limit = 3,
): NotificationItem[] {
  return sortNewestFirst(applyMutes(items.filter(isUnread), muted)).slice(0, limit);
}

// ─── formatting ───────────────────────────────────────────────────────────────

/**
 * Relative age for a row, e.g. "3mins", "1hr", "2 days". Returns "now" for an
 * unparseable or future timestamp rather than a bogus value, so a row whose
 * clock skewed still renders (the title is the information, not the age).
 */
export function notificationAge(createdAt: string, nowMs: number): string {
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t) || t > nowMs) return "now";
  return formatRelativeAge(t, nowMs) ?? "now";
}

/** Compact unread badge text; caps at "99+" so the pill never grows the header. */
export function unreadBadge(count: number): string {
  if (count <= 0) return "0";
  return count > 99 ? "99+" : String(count);
}

// ─── muted-category preference codec ──────────────────────────────────────────
// The settings store holds only primitives (each field is compared with !== and
// persisted via String()), so the muted set travels as a comma-separated string.
// These two functions are the ONLY place that encoding is known.

const CATEGORY_SET = new Set<string>(NOTIFICATION_CATEGORIES);

/** Parse "ci,media" → ["ci", "media"]. Unknown/blank entries are dropped. */
export function parseMutedCategories(raw: string): NotificationCategory[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is NotificationCategory => CATEGORY_SET.has(s));
}

/** Serialize a muted set back to storage form, deduped and in canonical order. */
export function serializeMutedCategories(categories: readonly NotificationCategory[]): string {
  const set = new Set(categories);
  return NOTIFICATION_CATEGORIES.filter((c) => set.has(c)).join(",");
}

/** Toggle one category in a muted set, returning the new storage string. */
export function toggleMutedCategory(
  raw: string,
  category: NotificationCategory,
  muted: boolean,
): string {
  const current = new Set(parseMutedCategories(raw));
  if (muted) current.add(category);
  else current.delete(category);
  return serializeMutedCategories([...current]);
}

// ─── quiet hours ──────────────────────────────────────────────────────────────

/** Minutes-since-midnight for "HH:MM"; null when the input isn't a valid time. */
export function parseClock(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Is `now` inside the quiet window? The window WRAPS midnight (22:00→07:00 is
 * the common case), so a start later than the end means "either side of
 * midnight" rather than an empty range. A start equal to the end is treated as
 * an empty window (quiet hours effectively off) rather than all-day silence ,
 * silencing the panel for 24h is never what an accidental equal pair means.
 */
export function isWithinQuietHours(nowHHMM: string, start: string, end: string): boolean {
  const now = parseClock(nowHHMM);
  const from = parseClock(start);
  const to = parseClock(end);
  if (now === null || from === null || to === null) return false;
  if (from === to) return false;
  if (from < to) return now >= from && now < to;
  return now >= from || now < to;
}

/** "HH:MM" for a Date, in local time , the form quiet-hours settings store. */
export function clockOf(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}
