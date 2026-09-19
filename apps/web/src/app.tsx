import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { useEffect } from "react";
import { PanelFrame } from "./components/PanelFrame";
import { queryClient, trpc, trpcClient } from "./lib/trpc";
import { useAccentTheme } from "./lib/useAccentTheme";
import { useDeviceSettingsSync } from "./lib/useDeviceSettingsSync";
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

// Same job for the per-device settings row (the device name). A SEPARATE
// component, not another hook call inside SettingsSync: each owns a tRPC
// query, and keeping them apart means one poll settling cannot re-render the
// other's subscribers.
function DeviceSettingsSync() {
  useDeviceSettingsSync();
  return null;
}

// Paints the chosen accent onto :root. Its own component for the same reason as
// DeviceSettingsSync , it subscribes to the settings store and renders nothing,
// so keeping it out of App means an accent change re-renders only this null
// node.
function AccentTheme() {
  useAccentTheme();
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
        <AccentTheme />
        <DeviceSettingsSync />
        {/* Caps the web app to the 1366x1024 panel resolution and, on a
            desktop browser with room to spare, frames it like a device.
            Passthrough (no-op) on the native kiosk shell , see PanelFrame.tsx. */}
        <PanelFrame>
          <RouterProvider router={router} />
        </PanelFrame>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
