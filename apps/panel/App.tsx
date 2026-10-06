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
import { AppState, Linking, Modal, Pressable, Share, StyleSheet, Text, View } from "react-native";
import WebView from "react-native-webview";
import type {
  WebViewMessageEvent,
  WebViewNavigation,
  WebViewOpenWindowEvent,
} from "react-native-webview/lib/WebViewTypes";
import { panelAlarms } from "./alarms";
import {
  bootReportScript,
  bootTimeoutMs,
  bootUrl,
  parseBootReport,
  recoveryDelayMs,
} from "./boot-recovery";

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
  alarmApiToken?: string;
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
  const openAlarmsOnLoad = useRef(false);
  // Each generation is a fresh WebView. A boot that never renders the board
  // bumps it, see boot-recovery.ts.
  const [generation, setGeneration] = useState(0);
  const [launchedAt] = useState(() => Date.now());
  const failedBoots = useRef(0);
  const bootWatchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingReload = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearBootWatchdog = useCallback(() => {
    if (bootWatchdog.current) clearTimeout(bootWatchdog.current);
    bootWatchdog.current = null;
  }, []);

  const recover = useCallback(() => {
    clearBootWatchdog();
    if (pendingReload.current) return;
    pendingReload.current = setTimeout(() => {
      pendingReload.current = null;
      failedBoots.current += 1;
      setGeneration((current) => current + 1);
    }, recoveryDelayMs(failedBoots.current));
  }, [clearBootWatchdog]);

  // Every generation must hear from the page that it rendered. Silence means
  // the load hung or the report script never ran.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-armed for each new WebView generation
  useEffect(() => {
    bootWatchdog.current = setTimeout(recover, bootTimeoutMs(failedBoots.current));
    return clearBootWatchdog;
  }, [generation, recover, clearBootWatchdog]);

  useEffect(
    () => () => {
      if (pendingReload.current) clearTimeout(pendingReload.current);
    },
    [],
  );

  const openAlarms = useCallback(() => {
    mainWebView.current?.injectJavaScript(
      'window.dispatchEvent(new Event("control-center-open-alarms")); true;',
    );
  }, []);

  useEffect(() => {
    const handleURL = (url: string | null) => {
      if (url !== "controlcenter://alarms") return;
      openAlarmsOnLoad.current = true;
      openAlarms();
    };
    void Linking.getInitialURL().then(handleURL);
    const subscription = Linking.addEventListener("url", ({ url }) => handleURL(url));
    return () => subscription.remove();
  }, [openAlarms]);

  useEffect(() => {
    if (!panelAlarms) return;
    const configure = panelAlarms.configure(
      serverUrl,
      extra.alarmApiToken ?? "",
      extra.cfAccessClientId ?? "",
      extra.cfAccessClientSecret ?? "",
    );
    const refresh = () => {
      void configure.then(() => panelAlarms?.refresh()).catch(() => {});
    };
    refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => subscription.remove();
  }, [serverUrl, extra.alarmApiToken, extra.cfAccessClientId, extra.cfAccessClientSecret]);

  const headers = useMemo(() => {
    if (!extra.cfAccessClientId || !extra.cfAccessClientSecret) return undefined;
    return {
      "CF-Access-Client-Id": extra.cfAccessClientId,
      "CF-Access-Client-Secret": extra.cfAccessClientSecret,
    };
  }, [extra.cfAccessClientId, extra.cfAccessClientSecret]);

  const source = useMemo(
    () => ({ uri: bootUrl(serverUrl, generation, launchedAt), headers }),
    [serverUrl, generation, launchedAt, headers],
  );

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
      // Privileged bridge messages only come from the hosted board's origin.
      try {
        if (new URL(event.nativeEvent.url).origin !== new URL(serverUrl).origin) return;
      } catch {
        return;
      }
      const report = parseBootReport(event.nativeEvent.data);
      if (report) {
        clearBootWatchdog();
        if (report.rendered) failedBoots.current = 0;
        else recover();
        return;
      }
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
          case "syncNextAlarm": {
            if (!panelAlarms) throw new Error("Alarm native module unavailable");
            await panelAlarms.syncNextAlarm(JSON.stringify({ next: request.params?.next ?? null }));
            result = null;
            break;
          }
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
    [respond, serverUrl, clearBootWatchdog, recover],
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
        key={generation}
        ref={mainWebView}
        source={source}
        style={styles.webView}
        originWhitelist={["https://*", "http://localhost:*"]}
        injectedJavaScriptBeforeContentLoaded={shellBootstrap}
        injectedJavaScript={bootReportScript}
        onMessage={handleRequest}
        onError={recover}
        onContentProcessDidTerminate={recover}
        renderError={() => (
          <View style={styles.loadError}>
            <Text style={styles.loadErrorText}>Reconnecting…</Text>
          </View>
        )}
        onLoadEnd={() => {
          if (openAlarmsOnLoad.current) {
            openAlarms();
            openAlarmsOnLoad.current = false;
          }
        }}
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
  loadError: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    backgroundColor: "#101419",
    justifyContent: "center",
  },
  loadErrorText: { color: "rgba(255,255,255,0.6)", fontSize: 17 },
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
