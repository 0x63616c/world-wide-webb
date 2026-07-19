import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { useEffect } from "react";
import { NotificationBridge } from "./components/NotificationBridge";
import { queryClient, trpc, trpcClient } from "./lib/trpc";
import { useSettingsSync } from "./lib/useSettingsSync";
import { startVersionCheck } from "./lib/version-check";
import { routeTree } from "./routeTree.gen";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Runs the global-settings sync loop. Rendered inside the tRPC + Query providers
// (it uses tRPC hooks) and returns nothing , it only wires store ↔ server.
function SettingsSync() {
  useSettingsSync();
  return null;
}

export function App() {
  // Kiosk auto-refresh (www-ss8s): poll the deployed build stamp and hard-reload
  // once when an OTA deploy ships a new SHA. No-op in local dev (hash "dev").
  useEffect(() => startVersionCheck(), []);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <SettingsSync />
        {/* Persists the board's ephemeral banner alerts into the Notification
            Center. Lives here, not in Board, because it needs the tRPC provider
            and renders nothing , and because keeping it out of Board keeps the
            banners (and Board's provider-free tests) untouched. */}
        <NotificationBridge />
        <RouterProvider router={router} />
      </QueryClientProvider>
    </trpc.Provider>
  );
}
