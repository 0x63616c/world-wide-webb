import type { CapacitorConfig } from "@capacitor/cli";

// The iOS app (web/ios) is a thin Capacitor "kiosk" shell: it renders the
// hosted dashboard full-screen rather than bundling it. server.url points at the
// live, hosted dashboard so the wall panel updates over the air with every
// deploy, no App Store rebuild required. CAPACITOR_DEV_SERVER_URL overrides it for
// local `cap run` against a dev server.
// This is a Capacitor CLI config file run under node by `cap`, not browser/app code,
// so process.env is the intended override mechanism for the dev server URL.
// www-jtp0.3.7 / Task 7 hostname cutover: production host is the Control Center
// product route app.worldwidewebb.co (CF route -> web:80 + kiosk service-token
// Access, both declared in infra/cloudflare). The flattened app--cc.worldwidewebb.co
// route it replaced was retired in Task 7 Step C once the panel was confirmed on
// app.worldwidewebb.co.
// biome-ignore lint/style/noProcessEnv: node-side CLI config, env override is intentional
const serverUrl = process.env.CAPACITOR_DEV_SERVER_URL || "https://app.worldwidewebb.co";

// CF Access headers (www-cuuw): the plan's preferred path was `server.headers` on
// this config. VERIFIED against the installed Capacitor 8 SDK
// (@capacitor/cli declarations.d.ts `server` type), there is NO `headers` field
// in Capacitor 8's server config, and the native iOS load issues a header-less
// `URLRequest(url:)` we cannot configure here. So per §5's verify-before-build
// fallback, the CF-Access service-token headers are injected natively instead:
// KioskViewController re-issues the initial origin load with the headers and the
// KioskWatchdog carries them on its probe + reload (web/ios/App/App).
// Credentials are baked into Info.plist at build time from repo secrets
// (Fastfile xcargs + ios-build.yml). Nothing to wire on this config object.
const config: CapacitorConfig = {
  // Bundle id is intentionally inherited from the original "Evee" TestFlight app so
  // new builds land as updates to the same app (see web/ios + ios-build.yml).
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
