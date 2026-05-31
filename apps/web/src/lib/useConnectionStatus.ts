import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

const ERROR_THRESHOLD_MS = 8_000;

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
            setStatus({ isLost: true, since: errorSinceRef.current });
          }, ERROR_THRESHOLD_MS);
        }
      } else {
        errorSinceRef.current = null;
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
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
