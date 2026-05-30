import type { AppRouter } from "@cc/api/trpc";
import { QueryClient } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

export const trpc = createTRPCReact<AppRouter>();

export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;

export const queryClient = new QueryClient();

// Vite proxies /trpc -> the api (API_PORT, default 4201). Same-origin in prod.
export const trpcClient = trpc.createClient({
  links: [httpBatchLink({ url: "/trpc" })],
});
