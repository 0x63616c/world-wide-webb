/**
 * ExpandedNotificationCenterView , pure presentational Notification Center.
 *
 * Bare page body (no <Modal>) , hosted by TileDetailHost , with two tabs
 * (Unread / All) over a list of severity-coded rows. Every piece of
 * state , the active tab, the rows, the loading flag, "now" , arrives as a prop
 * and every action leaves through an on* callback, so the whole surface is
 * exercisable in Storybook with no tRPC provider and no clock.
 *
 * `nowMs` is a prop rather than a `Date.now()` call so relative ages are
 * deterministic in stories and tests; the container passes a ticking now.
 */

import { Pill, PillTone, Segmented, Skeleton, StatusDot } from "@/components/ui";
import {
  CATEGORY_LABEL,
  EMPTY_COPY,
  isUnread,
  type NotificationFilter,
  type NotificationItem,
  notificationAge,
  SEVERITY_COLOR,
  unreadBadge,
} from "@/lib/notifications";

const TABS: readonly { value: NotificationFilter; label: string }[] = [
  { value: "unread", label: "Unread" },
  { value: "all", label: "All" },
];

export interface ExpandedNotificationCenterViewProps {
  /** Active tab , the same value the container passes to `notifications.list`. */
  filter: NotificationFilter;
  onFilterChange: (next: NotificationFilter) => void;
  /** Rows for the ACTIVE tab, already ordered + mute-filtered by the container. */
  items: NotificationItem[];
  /** Server-reported unread count (drives the header pill + Mark-all-read). */
  unreadCount: number;
  /** True while the active tab's query has no data yet , renders skeleton rows. */
  loading?: boolean;
  /** Set when the query failed and there is nothing cached to fall back to. */
  error?: string;
  /** Reference "now" for relative ages, in epoch ms. */
  nowMs: number;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}

export function ExpandedNotificationCenterView({
  filter,
  onFilterChange,
  items,
  unreadCount,
  loading = false,
  error,
  nowMs,
  onMarkRead,
  onMarkAllRead,
}: ExpandedNotificationCenterViewProps) {
  return (
    <div style={{ maxWidth: 920, margin: "0 auto" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Header bar: unread count + the bulk action. "Mark all read" is
            disabled rather than hidden when nothing is unread, so the control
            doesn't shift position as notifications arrive. */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Pill tone={unreadCount > 0 ? PillTone.Amber : PillTone.Default}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
              {unreadBadge(unreadCount)} unread
            </span>
          </Pill>
          <button
            type="button"
            onClick={onMarkAllRead}
            disabled={unreadCount === 0}
            style={{
              marginLeft: "auto",
              padding: "8px 14px",
              background: "var(--nest)",
              border: "1px solid var(--hair)",
              borderRadius: 10,
              fontFamily: "var(--ui)",
              fontSize: 13,
              color: unreadCount === 0 ? "var(--ink-3)" : "var(--ink-2)",
              cursor: unreadCount === 0 ? "default" : "pointer",
              opacity: unreadCount === 0 ? 0.6 : 1,
            }}
          >
            Mark all read
          </button>
        </div>

        <Segmented
          options={TABS}
          value={filter}
          onChange={onFilterChange}
          label="Notification filter"
        />

        {loading ? (
          <SkeletonRows />
        ) : error ? (
          <EmptyState title="Couldn't load notifications" sub={error} />
        ) : items.length === 0 ? (
          <EmptyState title={EMPTY_COPY[filter].title} sub={EMPTY_COPY[filter].sub} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((n) => (
              <NotificationRow key={n.id} item={n} nowMs={nowMs} onMarkRead={onMarkRead} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** One list row: severity rail, category + age meta, title, body, actions. */
function NotificationRow({
  item,
  nowMs,
  onMarkRead,
}: {
  item: NotificationItem;
  nowMs: number;
  onMarkRead: (id: string) => void;
}) {
  const unread = isUnread(item);

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        padding: 12,
        borderRadius: 12,
        background: "var(--nest)",
        border: "1px solid var(--hair)",
        // A read row recedes; the rail keeps severity legible at every state.
        opacity: unread ? 1 : 0.8,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 3,
          alignSelf: "stretch",
          borderRadius: 2,
          background: SEVERITY_COLOR[item.severity],
          flexShrink: 0,
        }}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* The dot is the unread affordance; read rows omit it entirely so the
              list reads as a stack of "still needs me" markers. */}
          {unread ? <StatusDot online /> : null}
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--ink-3)",
            }}
          >
            {CATEGORY_LABEL[item.category]}
          </span>
          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>·</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
            {notificationAge(item.createdAt, nowMs)}
          </span>
        </div>

        <span
          style={{
            fontSize: 15,
            color: "var(--ink)",
            fontWeight: unread ? 600 : 500,
            letterSpacing: "-0.01em",
          }}
        >
          {item.title}
        </span>

        {item.body ? (
          <span style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.45 }}>{item.body}</span>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
        {unread ? <RowAction onClick={() => onMarkRead(item.id)}>Mark read</RowAction> : null}
      </div>
    </div>
  );
}

function RowAction({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "5px 10px",
        background: "var(--tile)",
        border: "1px solid var(--hair)",
        borderRadius: 8,
        fontFamily: "var(--ui)",
        fontSize: 12,
        color: "var(--ink-2)",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function EmptyState({ title, sub }: { title: string; sub: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        padding: "48px 20px",
        textAlign: "center",
      }}
    >
      <span style={{ fontSize: 15, color: "var(--ink-2)", fontWeight: 550 }}>{title}</span>
      <span style={{ fontSize: 13, color: "var(--ink-3)" }}>{sub}</span>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {["a", "b", "c", "d"].map((k) => (
        <div
          key={k}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: 12,
            borderRadius: 12,
            background: "var(--nest)",
            border: "1px solid var(--hair)",
          }}
        >
          <Skeleton w="30%" h={12} borderRadius={6} />
          <Skeleton w="75%" h={18} borderRadius={8} />
        </div>
      ))}
    </div>
  );
}
