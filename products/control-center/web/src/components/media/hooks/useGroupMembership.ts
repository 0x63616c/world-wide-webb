/**
 * useGroupMembership hook — optimistic Sonos group membership with a
 * stale-poll reconcile gate. Membership analog of useMixer's volume
 * reconcile (www-tavs): a polled snapshot may only overwrite a room's
 * membership when it was FETCHED after that room's last local edit.
 */

import { useEffect, useRef, useState } from "react";

export interface GroupMembershipState {
  /** room uuid -> source id | null, optimistic-first. */
  member: Record<string, string | null>;
  /** Optimistically set a room's source and stamp lastEditAt. */
  setMember: (uuid: string, sourceId: string | null) => void;
}

/**
 * @param polled Polled membership snapshot: room uuid -> source id | null.
 * @param dataUpdatedAt When that snapshot was FETCHED (react-query
 *   dataUpdatedAt, epoch ms; 0 while no data). Reconciliation is gated on
 *   it: a snapshot may only overwrite a room it was fetched after that
 *   room's last local edit.
 */
export function useGroupMembership(
  polled: Record<string, string | null>,
  dataUpdatedAt: number,
): GroupMembershipState {
  const [member, setMemberState] = useState<Record<string, string | null>>(() => ({ ...polled }));

  // Tracks the last time a local edit (setMember) was made for each room
  // uuid. A polled snapshot only overwrites a room when it was fetched
  // AFTER that room's last local edit (dataUpdatedAt > lastEditAt) — a
  // stale cached snapshot replayed by an unrelated re-render can never
  // snap an edited room back.
  const lastEditAt = useRef<Record<string, number>>({});

  // Re-sync member when the poll changes:
  //  - Seed unknown rooms from the poll (no local edit yet).
  //  - Prune rooms no longer in the poll.
  //  - For existing rooms, overwrite from the poll only when the poll was
  //    fetched after the room's last local edit.
  useEffect(() => {
    const polledUuids = new Set(Object.keys(polled));
    setMemberState((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const uuid of polledUuids) {
        const sourceId = polled[uuid] ?? null;
        if (!(uuid in next)) {
          // Unknown room: seed from poll.
          next[uuid] = sourceId;
          changed = true;
        } else if (dataUpdatedAt > (lastEditAt.current[uuid] ?? 0)) {
          // Known room, snapshot fetched after the last local edit:
          // reconcile from poll if value differs.
          if (next[uuid] !== sourceId) {
            next[uuid] = sourceId;
            changed = true;
          }
        }
        // Snapshot older than the local edit: leave the local value untouched.
      }
      // Prune rooms that are no longer in the poll.
      for (const uuid of Object.keys(next)) {
        if (!polledUuids.has(uuid)) {
          delete next[uuid];
          changed = true;
        }
      }
      // Return prev UNCHANGED when nothing changed so the state reference
      // stays stable and React skips the re-render.
      return changed ? next : prev;
    });
  }, [polled, dataUpdatedAt]);

  const setMember = (uuid: string, sourceId: string | null) => {
    lastEditAt.current[uuid] = Date.now();
    setMemberState((prev) => ({ ...prev, [uuid]: sourceId }));
  };

  return { member, setMember };
}
