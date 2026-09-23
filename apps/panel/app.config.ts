import type { ConfigContext, ExpoConfig } from "expo/config";
import { type ConfigPlugin, withAppDelegate, withInfoPlist } from "expo/config-plugins";

// iOS 27 refuses to launch an app built with the iOS 27 SDK unless it adopts
// the UIScene life cycle. Expo ships `ExpoAppSceneDelegate` for this, but the
// SDK 57 prebuild template still creates the window in the app delegate, so
// wire it up here: the scene delegate creates the window and starts React
// Native from the factory the app delegate still owns.

const SCENE_DELEGATE_CLASS = "EXExpoAppSceneDelegate";

const APP_DELEGATE_DECLARATION = "class AppDelegate: ExpoAppDelegate {";
const WINDOW_START_BLOCK =
  /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

const withSceneLifecycle: ConfigPlugin = (config) => {
  config = withInfoPlist(config, (plistConfig) => {
    plistConfig.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: SCENE_DELEGATE_CLASS,
          },
        ],
      },
    };
    return plistConfig;
  });

  return withAppDelegate(config, (delegateConfig) => {
    const { contents, language } = delegateConfig.modResults;
    if (language !== "swift") throw new Error("withSceneLifecycle expects a Swift AppDelegate");
    if (contents.includes("ExpoReactNativeFactoryProvider")) return delegateConfig;
    // Fail the prebuild loudly if an Expo upgrade reshapes the template, rather
    // than shipping an app delegate that starts React Native twice or never.
    if (!contents.includes(APP_DELEGATE_DECLARATION) || !WINDOW_START_BLOCK.test(contents)) {
      throw new Error("withSceneLifecycle: AppDelegate.swift no longer matches the Expo template");
    }
    delegateConfig.modResults.contents = contents
      .replace(
        APP_DELEGATE_DECLARATION,
        "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {",
      )
      .replace(WINDOW_START_BLOCK, "");
    return delegateConfig;
  });
};

const productionUrl = "https://app.worldwidewebb.co";

export default ({ config }: ConfigContext): ExpoConfig =>
  withSceneLifecycle({
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
