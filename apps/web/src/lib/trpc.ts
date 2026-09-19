import type { AppRouter } from "@cc/api/trpc";
import { QueryClient } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";

export const trpc = createTRPCReact<AppRouter>();

export type RouterOutputs = inferRouterOutputs<AppRouter>;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Bounded retries with exponential backoff (1s, 2s, 4s, 8s, 16s, capped at
      // 30s). An unbounded 5s retry turns any upstream blip into a self-inflicted
      // request storm; this rides out transient failures without hammering.
      retry: 5,
      retryDelay: (attempt) => Math.min(30_000, 1_000 * 2 ** attempt),
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});

// Vite proxies /trpc -> the api (API_PORT, default 4201). Same-origin in prod.
export const trpcClient = trpc.createClient({
  links: [httpBatchLink({ url: "/trpc" })],
});
