/** The remote web app's single seam into the Expo panel shell. */

const CHANNEL = "control-center-native";
const RESPONSE_EVENT = "control-center-native-response";
const REQUEST_TIMEOUT_MS = 5_000;
let requestSequence = 0;

type NativeResponse<T> = {
  channel: typeof CHANNEL;
  id: string;
  ok: boolean;
  result?: T;
  error?: string;
};

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(message: string): void };
    __CONTROL_CENTER_EXPO__?: boolean;
  }
}

export function isNativeShell(): boolean {
  return window.__CONTROL_CENTER_EXPO__ === true && window.ReactNativeWebView != null;
}

export function nativeRequest<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  if (!isNativeShell()) return Promise.reject(new Error("Expo native bridge unavailable"));

  requestSequence += 1;
  const id = `native-${Date.now()}-${requestSequence}`;

  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener(RESPONSE_EVENT, onResponse as EventListener);
      reject(new Error(`Expo native request timed out: ${method}`));
    }, REQUEST_TIMEOUT_MS);

    function onResponse(event: Event) {
      const response = (event as CustomEvent<NativeResponse<T>>).detail;
      if (response?.channel !== CHANNEL || response.id !== id) return;
      window.clearTimeout(timeout);
      window.removeEventListener(RESPONSE_EVENT, onResponse as EventListener);
      if (response.ok) resolve(response.result as T);
      else reject(new Error(response.error ?? `Expo native request failed: ${method}`));
    }

    window.addEventListener(RESPONSE_EVENT, onResponse as EventListener);
    window.ReactNativeWebView?.postMessage(
      JSON.stringify({ channel: CHANNEL, id, method, params }),
    );
  });
}
