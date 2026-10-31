import SwiftUI
import WebKit

struct KioskWebView: UIViewRepresentable {
    let session: KioskSession

    func makeCoordinator() -> Coordinator { Coordinator(session: session) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.add(context.coordinator, name: "panel")
        configuration.userContentController.addUserScript(WKUserScript(
            source: KioskScripts.bootstrap, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        configuration.userContentController.addUserScript(WKUserScript(
            source: KioskScripts.bootReport, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 16 / 255, green: 20 / 255, blue: 25 / 255, alpha: 1)
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        session.webView = webView
        session.startBoot()
        var request = URLRequest(url: KioskBoot.url(serverURL: session.configuration.serverURL,
                                                   generation: session.generation, launchedAt: session.launchedAt))
        for (name, value) in session.configuration.accessHeaders { request.setValue(value, forHTTPHeaderField: name) }
        webView.load(request)
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.stopLoading()
        uiView.navigationDelegate = nil
        uiView.uiDelegate = nil
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "panel")
        if coordinator.session.webView === uiView { coordinator.session.webView = nil }
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        let session: KioskSession
        private let generation: Int

        init(session: KioskSession) {
            self.session = session
            generation = session.generation
        }

        private var isCurrent: Bool { generation == session.generation }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard isCurrent, let webView = message.webView, let raw = message.body as? String else { return }
            let origin = message.frameInfo.securityOrigin
            guard KioskURLPolicy.acceptsMessage(isMainFrame: message.frameInfo.isMainFrame,
                origin: WebOrigin(scheme: origin.protocol, host: origin.host, port: origin.port),
                pageURL: webView.url, serverURL: session.configuration.serverURL) else { return }
            if let report = BootReport.parse(raw) { session.receive(report); return }
            guard let request = NativeRequest.parse(raw) else { return }
            let frame = message.frameInfo
            Task {
                guard isCurrent,
                      KioskURLPolicy.isTrusted(webView.url, serverURL: session.configuration.serverURL) else { return }
                let response = await session.handle(request, in: webView)
                guard isCurrent, let json = try? response.encoded() else { return }
                // Recheck location in JavaScript too: navigation can race the
                // asynchronous evaluation even after native origin validation.
                webView.callAsyncJavaScript(KioskScripts.respond, arguments: [
                    "responseJSON": json, "serverURL": session.configuration.serverURL.absoluteString
                ],
                                            in: frame, in: .page, completionHandler: nil)
            }
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
            guard isCurrent, let url = navigationAction.request.url else { decisionHandler(.cancel); return }
            if navigationAction.targetFrame == nil {
                if let external = KioskURLPolicy.httpURL(url.absoluteString) { session.openBrowser(external) }
                decisionHandler(.cancel)
                return
            }
            guard KioskURLPolicy.isAllowed(url.absoluteString, serverURL: session.configuration.serverURL) else {
                if navigationAction.targetFrame?.isMainFrame == true,
                   let external = KioskURLPolicy.httpURL(url.absoluteString) { session.openBrowser(external) }
                decisionHandler(.cancel)
                return
            }
            if navigationAction.targetFrame?.isMainFrame == true {
                do { try session.prepareNativeAlarmNavigation() }
                catch { decisionHandler(.cancel); return }
                // Main-frame requests get credentials only for the exact board
                // origin, even when the kiosk allow-list permits another host.
                var request = navigationAction.request
                let headers = session.configuration.accessHeaders
                let trusted = KioskURLPolicy.isTrusted(url, serverURL: session.configuration.serverURL)
                var changed = false
                for name in ["CF-Access-Client-Id", "CF-Access-Client-Secret"] {
                    let expected = trusted ? headers[name] : nil
                    if request.value(forHTTPHeaderField: name) != expected {
                        request.setValue(expected, forHTTPHeaderField: name)
                        changed = true
                    }
                }
                if changed {
                    decisionHandler(.cancel)
                    webView.load(request)
                    return
                }
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            guard isCurrent else { return }
            session.startBoot()
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
            failed(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
            failed(error)
        }

        private func failed(_ error: any Error) {
            guard isCurrent, (error as NSError).code != NSURLErrorCancelled else { return }
            session.recover()
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            if isCurrent { session.recover() }
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if isCurrent, let raw = navigationAction.request.url?.absoluteString,
               let url = KioskURLPolicy.httpURL(raw) { session.openBrowser(url) }
            return nil
        }

        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                     initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                     decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void) {
            let trusted = KioskURLPolicy.acceptsMessage(isMainFrame: frame.isMainFrame,
                origin: WebOrigin(scheme: origin.protocol, host: origin.host, port: origin.port),
                pageURL: webView.url, serverURL: session.configuration.serverURL)
            decisionHandler(trusted ? .grant : .prompt)
        }
    }
}
