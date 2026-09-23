import * as Application from "expo-application";
import { setAudioModeAsync } from "expo-audio";
import * as Battery from "expo-battery";
import * as Brightness from "expo-brightness";
import { Camera } from "expo-camera";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { useKeepAwake } from "expo-keep-awake";
import * as ScreenOrientation from "expo-screen-orientation";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, Share, StyleSheet, Text, View } from "react-native";
import WebView from "react-native-webview";
import type {
  WebViewMessageEvent,
  WebViewNavigation,
  WebViewOpenWindowEvent,
} from "react-native-webview/lib/WebViewTypes";

type NativeRequest = {
  channel: "control-center-native";
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

type NativeResponse = {
  channel: "control-center-native";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

type AppExtra = {
  serverUrl?: string;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
};

const shellBootstrap = `
  window.__CONTROL_CENTER_EXPO__ = true;
  true;
`;

function isAllowedKioskUrl(rawUrl: string, serverUrl: string): boolean {
  if (rawUrl === "about:blank" || rawUrl.startsWith("blob:")) return true;
  try {
    const candidate = new URL(rawUrl);
    const origin = new URL(serverUrl);
    if (candidate.protocol !== "https:" && candidate.protocol !== "http:") return false;
    if (candidate.hostname === "localhost") return true;
    return (
      candidate.hostname === origin.hostname || candidate.hostname.endsWith(".worldwidewebb.co")
    );
  } catch {
    return false;
  }
}

export default function App() {
  useKeepAwake();
  const mainWebView = useRef<WebView>(null);
  const extra = (Constants.expoConfig?.extra ?? {}) as AppExtra;
  const serverUrl = extra.serverUrl ?? "https://app.worldwidewebb.co";
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);

  const headers = useMemo(() => {
    if (!extra.cfAccessClientId || !extra.cfAccessClientSecret) return undefined;
    return {
      "CF-Access-Client-Id": extra.cfAccessClientId,
      "CF-Access-Client-Secret": extra.cfAccessClientSecret,
    };
  }, [extra.cfAccessClientId, extra.cfAccessClientSecret]);

  useEffect(() => {
    void Camera.requestCameraPermissionsAsync();
    void setAudioModeAsync({ playsInSilentMode: true });
    void Device.getDeviceTypeAsync().then((deviceType) =>
      ScreenOrientation.lockAsync(
        deviceType === Device.DeviceType.TABLET
          ? ScreenOrientation.OrientationLock.LANDSCAPE
          : ScreenOrientation.OrientationLock.PORTRAIT,
      ),
    );
  }, []);

  const respond = useCallback((response: NativeResponse) => {
    const detail = JSON.stringify(response);
    mainWebView.current?.injectJavaScript(
      `window.dispatchEvent(new CustomEvent("control-center-native-response", { detail: ${detail} })); true;`,
    );
  }, []);

  const handleRequest = useCallback(
    async (event: WebViewMessageEvent) => {
      let request: NativeRequest;
      try {
        request = JSON.parse(event.nativeEvent.data) as NativeRequest;
        if (request.channel !== "control-center-native" || typeof request.id !== "string") return;
      } catch {
        return;
      }

      try {
        let result: unknown;
        switch (request.method) {
          case "deviceInfo": {
            result = {
              model: Device.modelId ?? Device.modelName ?? "ios",
              identifier: (await Application.getIosIdForVendorAsync()) ?? "",
            };
            break;
          }
          case "batteryInfo": {
            const [level, state] = await Promise.all([
              Battery.getBatteryLevelAsync(),
              Battery.getBatteryStateAsync(),
            ]);
            result = {
              batteryLevel: level < 0 ? null : level,
              isCharging:
                state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL,
            };
            break;
          }
          case "setBrightness": {
            const level = request.params?.level;
            if (typeof level !== "number") throw new Error("Missing brightness level");
            await Brightness.setBrightnessAsync(Math.max(0, Math.min(1, level)));
            result = null;
            break;
          }
          case "share": {
            const url = request.params?.url;
            if (typeof url !== "string") throw new Error("Missing share URL");
            await Share.share({ title: "Photo booth", url });
            result = null;
            break;
          }
          case "openBrowser": {
            const url = request.params?.url;
            if (typeof url !== "string") throw new Error("Missing browser URL");
            setBrowserUrl(url);
            result = null;
            break;
          }
          case "closeBrowser": {
            setBrowserUrl(null);
            result = null;
            break;
          }
          default:
            throw new Error(`Unknown native method: ${request.method}`);
        }
        respond({ channel: "control-center-native", id: request.id, ok: true, result });
      } catch (error) {
        respond({
          channel: "control-center-native",
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : "Native request failed",
        });
      }
    },
    [respond],
  );

  const allowMainNavigation = useCallback(
    (request: WebViewNavigation) => {
      if (isAllowedKioskUrl(request.url, serverUrl)) return true;
      if (request.url.startsWith("http://") || request.url.startsWith("https://")) {
        setBrowserUrl(request.url);
      }
      return false;
    },
    [serverUrl],
  );

  const openWindow = useCallback((event: WebViewOpenWindowEvent) => {
    setBrowserUrl(event.nativeEvent.targetUrl);
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <WebView
        ref={mainWebView}
        source={{ uri: serverUrl, headers }}
        style={styles.webView}
        originWhitelist={["https://*", "http://localhost:*"]}
        injectedJavaScriptBeforeContentLoaded={shellBootstrap}
        onMessage={handleRequest}
        onOpenWindow={openWindow}
        onShouldStartLoadWithRequest={allowMainNavigation}
        allowsBackForwardNavigationGestures={false}
        allowsInlineMediaPlayback
        allowsLinkPreview={false}
        javaScriptEnabled
        mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
        mediaPlaybackRequiresUserAction={false}
        setSupportMultipleWindows={false}
      />
      <Modal visible={browserUrl !== null} animationType="slide" presentationStyle="fullScreen">
        <View style={styles.browser}>
          <View style={styles.browserBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Done"
              hitSlop={12}
              onPress={() => setBrowserUrl(null)}
            >
              <Text style={styles.done}>Done</Text>
            </Pressable>
          </View>
          {browserUrl ? (
            <WebView
              source={{ uri: browserUrl }}
              style={styles.webView}
              allowsBackForwardNavigationGestures={false}
              allowsLinkPreview={false}
              javaScriptEnabled
              setSupportMultipleWindows={false}
            />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#101419" },
  webView: { flex: 1, backgroundColor: "#101419" },
  browser: { flex: 1, backgroundColor: "#000000" },
  browserBar: {
    alignItems: "flex-end",
    backgroundColor: "#101419",
    paddingBottom: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  done: { color: "#ffffff", fontSize: 17, fontWeight: "600", lineHeight: 44 },
});
