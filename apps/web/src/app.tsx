import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { useEffect } from "react";
import { queryClient, trpc, trpcClient } from "./lib/trpc";
import { startVersionCheck } from "./lib/version-check";
import { routeTree } from "./routeTree.gen";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  // Kiosk auto-refresh (www-ss8s): poll the deployed build stamp and hard-reload
  // once when an OTA deploy ships a new SHA. No-op in local dev (hash "dev").
  useEffect(() => startVersionCheck(), []);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </trpc.Provider>
  );
}
