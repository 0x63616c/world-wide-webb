/**
 * useBoardLayout , bridges the server-persisted board layout (tRPC
 * `layout.get`) with the pure `resolveLayout` resolver, so Board renders
 * free-placed tiles instead of the static registry defaults.
 *
 *  - Blocking first paint: `status` stays "loading" until the FIRST query
 *    attempt settles, success or error alike , Board must never flash fake
 *    or default-registry tiles before it knows the real placement. An error
 *    still settles to "ready" (falling back to the registry defaults via
 *    `resolveLayout([])`) rather than blocking forever; `ConnectionLostBanner`
 *    already surfaces the API-down signal elsewhere on the board.
 *  - Revision-gated apply: a poll (POLL.layout) that returns the same
 *    `revision` is a no-op , resolveLayout is skipped and the previously
 *    resolved layout (and its object identity) is kept, so nothing downstream
 *    re-renders off an unchanged layout.
 *
 * No local write path here (this task is read-only board consumption); the
 * layout editor (a later task) drives `layout.save` and invalidates this query.
 */
import { useEffect, useRef, useState } from "react";
import { type ResolvedLayout, resolveLayout } from "./board-layout";
import { POLL } from "./hooks";
import { trpc } from "./trpc";

export type BoardLayoutState = {
  status: "loading" | "ready";
  layout: ResolvedLayout;
  revision: string | null;
  refetch: () => void;
};

// Registry defaults (no saved placements) , the initial value before the first
// query settles, and the permanent fallback if the query only ever errors.
const DEFAULT_LAYOUT: ResolvedLayout = resolveLayout([]);

export function useBoardLayout(): BoardLayoutState {
  const query = trpc.layout.get.useQuery(undefined, { refetchInterval: POLL.layout });

  const [applied, setApplied] = useState<{ layout: ResolvedLayout; revision: string | null }>({
    layout: DEFAULT_LAYOUT,
    revision: null,
  });
  // `undefined` = nothing applied yet, distinct from a real `revision` of `null`
  // (an empty table), so the very first successful fetch always applies even if
  // its revision happens to be null.
  const appliedRevision = useRef<string | null | undefined>(undefined);

  const data = query.data;
  useEffect(() => {
    if (!data) return;
    if (data.revision === appliedRevision.current) return;
    appliedRevision.current = data.revision;
    setApplied({ layout: resolveLayout(data.placements), revision: data.revision });
  }, [data]);

  // Ready once the FIRST attempt settles (success or error); stays ready for
  // every subsequent poll/retry, error or not.
  const settled = query.isSuccess || query.isError;
  const [everSettled, setEverSettled] = useState(false);
  useEffect(() => {
    if (settled) setEverSettled(true);
  }, [settled]);

  return {
    status: everSettled ? "ready" : "loading",
    layout: applied.layout,
    revision: applied.revision,
    refetch: () => {
      void query.refetch();
    },
  };
}
