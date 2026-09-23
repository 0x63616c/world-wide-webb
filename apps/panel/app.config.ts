import type { ConfigContext, ExpoConfig } from "expo/config";

const productionUrl = "https://app.worldwidewebb.co";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Control Center",
  slug: "control-center",
  version: "1.0",
  orientation: "default",
  icon: "./assets/icon.png",
  userInterfaceStyle: "dark",
  backgroundColor: "#101419",
  // The shell always loads the live site; its JS never ships over the air.
  updates: { enabled: false },
  ios: {
    bundleIdentifier: "co.worldwidewebb.theworkflowengine",
    entitlements: { "aps-environment": "production" },
    supportsTablet: true,
    requireFullScreen: true,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSCameraUsageDescription:
        "Control Center takes a front-camera photo when the panel is woken from sleep.",
      NSMicrophoneUsageDescription:
        "Control Center uses the microphone for hands-free voice control.",
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
      UIIdleTimerDisabled: true,
      UIRequiresFullScreen: true,
      UIStatusBarHidden: true,
      UISupportedInterfaceOrientations: [
        "UIInterfaceOrientationPortrait",
        "UIInterfaceOrientationPortraitUpsideDown",
      ],
      "UISupportedInterfaceOrientations~ipad": [
        "UIInterfaceOrientationLandscapeLeft",
        "UIInterfaceOrientationLandscapeRight",
      ],
      UIViewControllerBasedStatusBarAppearance: false,
    },
  },
  plugins: [
    "expo-audio",
    "expo-camera",
    "expo-screen-orientation",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#101419",
        image: "./assets/splash-icon.png",
        imageWidth: 200,
      },
    ],
  ],
  extra: {
    serverUrl: process.env.CONTROL_CENTER_SERVER_URL || productionUrl,
    cfAccessClientId: process.env.CF_ACCESS_KIOSK_CLIENT_ID || "",
    cfAccessClientSecret: process.env.CF_ACCESS_KIOSK_CLIENT_SECRET || "",
  },
});
