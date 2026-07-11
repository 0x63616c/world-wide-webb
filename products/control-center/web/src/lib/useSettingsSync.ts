/**
 * useSettingsSync , bridges the local settings store (lib/settings) with the
 * server-persisted global settings, so every wall panel shares one config.
 *
 *  - Server → store: adopt the authoritative settings on load and on each poll
 *    (POLL.settings), unless a local write is mid-flight (never clobber the
 *    optimistic value the user just set).
 *  - Store → server: a user edit fires the store's server sink; edits are
 *    debounced into a single mutation (so dragging a slider isn't a write per
 *    frame), then the query is invalidated to settle.
 *
 * Mount ONCE, inside the tRPC + Query providers (see app.tsx). No realtime push
 * exists in this stack, so cross-panel propagation is one poll interval.
 */

import { useEffect, useRef } from "react";
import { POLL } from "./hooks";
import { hydrateSettings, registerServerSink, type Settings } from "./settings";
import { trpc } from "./trpc";

const PUSH_DEBOUNCE_MS = 400;

export function useSettingsSync(): void {
  const utils = trpc.useUtils();
  const query = trpc.settings.get.useQuery(undefined, { refetchInterval: POLL.settings });
  const mutation = trpc.settings.set.useMutation();

  // Latest mutate held in a ref so the sink effect can wire exactly once.
  const mutateRef = useRef(mutation.mutate);
  mutateRef.current = mutation.mutate;

  // Count of in-flight local writes; while >0 we skip server→store hydration so
  // a poll that raced the write can't overwrite what the user just changed.
  const inFlight = useRef(0);

  const data = query.data;
  useEffect(() => {
    if (data && inFlight.current === 0) hydrateSettings(data);
  }, [data]);

  useEffect(() => {
    let timer = 0;
    let pending: Settings | null = null;
    const flush = () => {
      const payload = pending;
      pending = null;
      if (!payload) return;
      inFlight.current += 1;
      mutateRef.current(payload, {
        onSettled: () => {
          inFlight.current = Math.max(0, inFlight.current - 1);
          void utils.settings.get.invalidate();
        },
      });
    };
    const unregister = registerServerSink((next) => {
      pending = next;
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, PUSH_DEBOUNCE_MS);
    });
    return () => {
      window.clearTimeout(timer);
      unregister();
    };
  }, [utils]);
}
