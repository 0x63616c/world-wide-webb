/**
 * NotificationBridge , renders nothing; persists the board's ephemeral banner
 * alerts into the Notification Center.
 *
 * Mounted as a SIBLING of the banners rather than folded into them, for three
 * reasons:
 *
 *  1. The banners stay free of tRPC. ConnectionLostBanner in particular pairs
 *     `useConnectionStatus` (which subscribes to the React Query cache and sets
 *     state on every cache event) with nothing else , adding a query beside it
 *     in the same component is a known feedback-loop shape in this codebase.
 *  2. One place owns the mapping and the de-dupe latch, instead of three.
 *  3. New banners need no wiring: they raise into the shared store as they
 *     already do, and opt into history by adding a spec in lib/notification-bridge.
 *
 * The connection outage is the one case that cannot be a straight pass-through:
 * the banner fires exactly when the API is unreachable, so the row is written on
 * RECOVERY instead, keyed by when the outage started. See `outageAlert`.
 *
 * No query invalidation happens here on purpose , the center polls every 5s
 * (POLL.notifications), and invalidating would churn the very query cache
 * `useConnectionStatus` watches.
 */

import { useEffect, useRef } from "react";
import {
  alertsSignature,
  alertToRaise,
  CONNECTION_ALERT_ID,
  outageAlert,
} from "../lib/notification-bridge";
import { trpc } from "../lib/trpc";
import { useNotifications } from "../lib/useNotifications";

export function NotificationBridge() {
  const { notifications } = useNotifications();
  const raise = trpc.notifications.raise.useMutation();

  // Held in refs so the effect depends ONLY on the alert signature: a fresh
  // mutate closure or a new array identity must not re-run the bridge.
  const mutateRef = useRef(raise.mutate);
  mutateRef.current = raise.mutate;
  const alertsRef = useRef(notifications);
  alertsRef.current = notifications;

  /** Dedupe keys already sent this session , saves the request, not just the row. */
  const sentRef = useRef<Set<string>>(new Set());
  /** When the current outage began, or null while the API is reachable. */
  const outageStartedRef = useRef<number | null>(null);

  const signature = alertsSignature(notifications);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `signature` is a content-change tripwire the effect never reads, not a missing value , see the note at the end of the effect body.
  useEffect(() => {
    const alerts = alertsRef.current;

    const send = (payload: ReturnType<typeof outageAlert>) => {
      if (sentRef.current.has(payload.dedupeKey)) return;
      sentRef.current.add(payload.dedupeKey);
      mutateRef.current(payload);
    };

    // ── connection outage: record on recovery, never while down ──────────────
    const isLost = alerts.some((a) => a.id === CONNECTION_ALERT_ID);
    if (isLost) {
      // Latch the start once; a flickering banner is still one outage.
      outageStartedRef.current ??= Date.now();
    } else if (outageStartedRef.current !== null) {
      const startedAt = outageStartedRef.current;
      outageStartedRef.current = null;
      send(outageAlert(startedAt, Date.now()));
    }

    // ── every other banner: straight pass-through ────────────────────────────
    for (const alert of alerts) {
      const payload = alertToRaise(alert);
      if (payload) send(payload);
    }
    // `signature` below is a deliberate change-DETECTOR, not a value this effect
    // reads. The alerts come from a ref so a new array identity (the store hands
    // one back on every raise/clear) cannot re-run the bridge; the signature is
    // what says the CONTENT actually changed. Depending on `notifications`
    // directly would re-run on every store emission, and dropping the dep would
    // run this once at mount and miss every alert after it.
  }, [signature]);

  return null;
}
