import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { log } from "./log/logger";
import { failingQueryKeys } from "./log/query-log";

const ERROR_THRESHOLD_MS = 8_000;

const connLog = log.child("conn");

export interface ConnectionStatus {
  isLost: boolean;
  since: number | null;
}

/**
 * Watches the React Query cache for a sustained outage. We subscribe to the
 * QueryClient's cache event stream and track how long at least one query has
 * been in an error+fetching state. Only flips isLost=true after the threshold
 * so a brief blip doesn't flash the banner.
 */
export function useConnectionStatus(): ConnectionStatus {
  const queryClient = useQueryClient();
  const errorSinceRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors `status.isLost` outside React state so the transition can be logged
  // from the effect (a side effect in a setState updater would run twice under
  // StrictMode and double-log).
  const lostRef = useRef(false);
  const [status, setStatus] = useState<ConnectionStatus>({ isLost: false, since: null });

  useEffect(() => {
    function checkQueries() {
      const queries = queryClient.getQueryCache().getAll();
      const anyFailing = queries.some((q) => q.state.status === "error");

      if (anyFailing) {
        if (errorSinceRef.current === null) {
          errorSinceRef.current = Date.now();
        }
        if (timerRef.current === null) {
          timerRef.current = setTimeout(() => {
            // The banner says "unable to connect" and nothing more. This is the
            // line that says WHICH queries are down, so the log can be read back
            // later and explain a banner nobody was standing there to see.
            lostRef.current = true;
            connLog.error("connection lost", {
              failing: failingQueryKeys(queryClient),
              erroringForMs: errorSinceRef.current ? Date.now() - errorSinceRef.current : 0,
            });
            setStatus({ isLost: true, since: errorSinceRef.current });
          }, ERROR_THRESHOLD_MS);
        }
      } else {
        errorSinceRef.current = null;
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        if (lostRef.current) {
          lostRef.current = false;
          connLog.info("connection restored");
        }
        setStatus({ isLost: false, since: null });
      }
    }

    checkQueries();
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      checkQueries();
    });

    return () => {
      unsubscribe();
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [queryClient]);

  return status;
}
