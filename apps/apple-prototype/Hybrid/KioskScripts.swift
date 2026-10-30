import Foundation

enum KioskScripts {
    // Preserve the deployed web app's Expo detection and postMessage protocol.
    static let bootstrap = """
    window.__CONTROL_CENTER_EXPO__ = true;
    window.ReactNativeWebView = {
      postMessage: function(message) { window.webkit.messageHandlers.panel.postMessage(message); }
    };
    true;
    """

    static let bootReport = """
    (function () {
      var deadline = Date.now() + 15000;
      function report(rendered) {
        window.ReactNativeWebView.postMessage(
          JSON.stringify({ channel: "control-center-shell", rendered: rendered })
        );
      }
      (function check() {
        var root = document.getElementById("root");
        if (root && root.childElementCount > 0) return report(true);
        if (Date.now() >= deadline) return report(false);
        setTimeout(check, 250);
      })();
    })();
    true;
    """

    static let openAlarms = """
    window.dispatchEvent(new Event("control-center-open-alarms")); true;
    """

    // Pass JSON as an argument to callAsyncJavaScript, never interpolate request
    // IDs, URLs, or server-provided strings into executable JavaScript.
    static let respond = """
    window.dispatchEvent(new CustomEvent("control-center-native-response", { detail: JSON.parse(responseJSON) }));
    """
}
