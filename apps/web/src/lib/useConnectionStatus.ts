import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

const ERROR_THRESHOLD_MS = 8_000;

export interface ConnectionStatus {
  isLost: boolean;
  since: number | null;
}

/**
 * True when a query error means "the server could not be reached", as opposed to
 * "the server answered with an error". A tRPC procedure that throws (e.g.
 * SERVICE_UNAVAILABLE because one HA entity is down) produces a TRPCClientError
 * carrying `data.httpStatus` from the parsed response body; a network-level
 * failure (fetch TypeError, ingress 502 with an unparseable body) has no
 * structured data. Only the latter is evidence the CONNECTION is lost , a
 * dashboard where one integration is down must not spam outage notifications
 * while every other tile is happily refetching.
 */
export function isConnectivityError(error: unknown): boolean {
  const httpStatus = (error as { data?: { httpStatus?: number } } | null)?.data?.httpStatus;
  return typeof httpStatus !== "number";
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
      const anyFailing = queries.some(
        (q) => q.state.status === "error" && isConnectivityError(q.state.error),
      );

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
