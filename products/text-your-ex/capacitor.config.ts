import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "co.worldwidewebb.textyourex",
  appName: "Text Your Ex",
  // Vite builds the web app into web/dist; Capacitor bundles that offline.
  webDir: "web/dist",
  ios: {
    contentInset: "always",
  },
};

export default config;
