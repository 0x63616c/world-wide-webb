import type { CapacitorConfig } from "@capacitor/cli";

// The iOS app (apps/web/ios) is a thin Capacitor "kiosk" shell: it renders the
// hosted dashboard full-screen rather than bundling it. server.url points at the
// live, bosun-served dashboard so the wall panel updates over the air with every
// deploy, no App Store rebuild required. CAPACITOR_DEV_SERVER_URL overrides it for
// local `cap run` against a dev server.
// This is a Capacitor CLI config file run under node by `cap`, not browser/app code,
// so process.env is the intended override mechanism for the dev server URL.
// biome-ignore lint/style/noProcessEnv: node-side CLI config, env override is intentional
const serverUrl = process.env.CAPACITOR_DEV_SERVER_URL || "https://dashboard.worldwidewebb.co";

const config: CapacitorConfig = {
  // Bundle id is intentionally inherited from the original "Evee" TestFlight app so
  // new builds land as updates to the same app (see apps/web/ios + ios-build.yml).
  appId: "co.worldwidewebb.theworkflowengine",
  appName: "Control Center",
  webDir: "dist",
  backgroundColor: "#000000",
  server: {
    url: serverUrl,
    cleartext: true,
    allowNavigation: ["*.worldwidewebb.co", "localhost"],
  },
};

export default config;
