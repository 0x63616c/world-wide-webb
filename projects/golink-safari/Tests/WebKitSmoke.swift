import AppKit
import Network
import WebKit

// Real WebKit extension engine, isolated from Safari profiles and settings.
// Only synthetic fixture queries are used and nothing leaves this machine: the tailnet
// navigation is cancelled, and browser views use a proxy on a local port that refuses
// connections, so a search the extension leaves alone fails at once with its own URL.
@MainActor
final class WebKitSmoke: NSObject, WKNavigationDelegate, WKWebExtensionControllerDelegate,
  WKWebExtensionWindow, WKWebExtensionTab
{
  private var webView: WKWebView!
  private var controller: WKWebExtensionController!
  private var context: WKWebExtensionContext!
  private var resolverActive = false
  private var ordinarySearch = false
  private var previousViews: [WKWebView] = []
  private var lifecycleCompletion: CheckedContinuation<Void, any Error>?
  private var lifecycleProbeStarted = false
  private let ordinaryURL = URL(
    string: "https://www.google.com/search?q=go%2Frepo+explanation&client=safari")!
  private var refusingPort: NWEndpoint.Port!

  func run() async throws {
    let resources = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    let webExtension: WKWebExtension
    if resources.pathExtension == "appex", let bundle = Bundle(url: resources) {
      webExtension = try await WKWebExtension(appExtensionBundle: bundle)
    } else {
      webExtension = try await WKWebExtension(resourceBaseURL: resources)
    }
    guard webExtension.errors.isEmpty else { fail("Invalid extension manifest") }
    context = WKWebExtensionContext(for: webExtension)
    // This permission applies only to the nonpersistent test data store.
    context.hasAccessToPrivateData = true
    context.setPermissionStatus(.grantedExplicitly, for: .declarativeNetRequestWithHostAccess)
    for host in ["https://www.google.com/*", "https://google.com/*"] {
      context.setPermissionStatus(
        .grantedExplicitly, for: try WKWebExtension.MatchPattern(string: host))
    }
    refusingPort = unusedLocalPort()
    controller = WKWebExtensionController(configuration: .nonPersistent())
    controller.delegate = self
    try controller.load(context)
    makeBrowserView()
    controller.didOpenWindow(self)
    try await context.loadBackgroundContent()
    try await verifyRuleLifecycle()
    guard context.errors.isEmpty else { fail("Concurrent rule requests caused an extension error") }
    makeBrowserView()
    webView.load(
      URLRequest(url: URL(string: "https://www.google.com/search?q=go%2Frepo&client=safari")!))
    // Bounds the wait; every expected outcome exits from a navigation callback first.
    try await Task.sleep(for: .seconds(25))
    fail("Timed out waiting for WebKit redirect/search evidence")
  }

  /// A loopback port the system just handed out and nothing listens on, so connections to it
  /// are refused immediately.
  private func unusedLocalPort() -> NWEndpoint.Port {
    let descriptor = socket(AF_INET, SOCK_STREAM, 0)
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_addr.s_addr = inet_addr("127.0.0.1")
    var length = socklen_t(MemoryLayout<sockaddr_in>.size)
    let bound = withUnsafeMutablePointer(to: &address) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.bind(descriptor, $0, length) == 0 && getsockname(descriptor, $0, &length) == 0
      }
    }
    Darwin.close(descriptor)
    guard bound, let port = NWEndpoint.Port(rawValue: UInt16(bigEndian: address.sin_port))
    else { fail("Could not find an unused local port") }
    return port
  }

  private func verifyRuleLifecycle() async throws {
    previousViews.append(webView)
    webView = WKWebView(frame: .zero, configuration: context.webViewConfiguration!)
    webView.navigationDelegate = self
    try await withCheckedThrowingContinuation { continuation in
      lifecycleCompletion = continuation
      webView.load(URLRequest(url: context.baseURL.appendingPathComponent("popup.html")))
      Task { @MainActor in
        try? await Task.sleep(for: .seconds(10))
        finishLifecycle(
          .failure(
            NSError(
              domain: "GolinkLifecycle", code: 2,
              userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for popup rule verification"]
            )))
      }
    }
  }

  private func finishLifecycle(_ result: Result<Void, any Error>) {
    guard let completion = lifecycleCompletion else { return }
    lifecycleCompletion = nil
    completion.resume(with: result)
  }

  private func makeBrowserView() {
    if let webView { previousViews.append(webView) }
    let configuration = WKWebViewConfiguration()
    configuration.webExtensionController = controller
    let store = WKWebsiteDataStore.nonPersistent()
    store.proxyConfigurations = [
      ProxyConfiguration(httpCONNECTProxy: .hostPort(host: "127.0.0.1", port: refusingPort))
    ]
    configuration.websiteDataStore = store
    webView = WKWebView(
      frame: NSRect(x: 0, y: 0, width: 800, height: 600), configuration: configuration)
    webView.navigationDelegate = self
  }

  func webExtensionController(
    _ controller: WKWebExtensionController, openWindowsFor context: WKWebExtensionContext
  )
    -> [any WKWebExtensionWindow]
  { [self] }
  func webExtensionController(
    _ controller: WKWebExtensionController, focusedWindowFor context: WKWebExtensionContext
  )
    -> (any WKWebExtensionWindow)?
  { self }
  func tabs(for context: WKWebExtensionContext) -> [any WKWebExtensionTab] { [self] }
  func activeTab(for context: WKWebExtensionContext) -> (any WKWebExtensionTab)? { self }
  func webView(for context: WKWebExtensionContext) -> WKWebView? { webView }
  func window(for context: WKWebExtensionContext) -> (any WKWebExtensionWindow)? { self }

  func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = action.request.url else {
      decisionHandler(.cancel)
      return
    }
    if url.scheme == context.baseURL.scheme {
      if lifecycleCompletion != nil {
        decisionHandler(.allow)
        return
      }
      guard !ordinarySearch else { fail("Ordinary search was intercepted") }
      if !resolverActive {
        resolverActive = true
        decisionHandler(.cancel)
        previousViews.append(webView)
        // Apple requires a dedicated configuration for extension origins.
        self.webView = WKWebView(frame: webView.frame, configuration: context.webViewConfiguration!)
        self.webView.navigationDelegate = self
        self.webView.load(URLRequest(url: url))
        return
      }
    }
    if url.host == "go.tail8c014d.ts.net" {
      guard resolverActive, url.absoluteString == "https://go.tail8c014d.ts.net/repo" else {
        fail("Wrong go-link destination")
      }
      decisionHandler(.cancel)
      print("PASS WebKit DNR → packaged resolver → fixed tailnet URL")
      ordinarySearch = true
      makeBrowserView()
      self.webView.load(URLRequest(url: ordinaryURL))
      return
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if lifecycleCompletion != nil, !lifecycleProbeStarted {
      lifecycleProbeStarted = true
      Task { @MainActor in
        do {
          // The first reply means the background page has finished installing the rules.
          let installed = try await webView.callAsyncJavaScript(
            "return (await browser.runtime.sendMessage({type: 'ensure-redirect-rules'}))?.ready === true",
            arguments: [:], in: nil, contentWorld: .page)
          guard installed as? Bool == true, context.errors.isEmpty else {
            throw NSError(
              domain: "GolinkLifecycle", code: 3,
              userInfo: [NSLocalizedDescriptionKey: "Safari could not install the redirect rules"])
          }
          let result = try await webView.callAsyncJavaScript(
            """
            const current = await browser.declarativeNetRequest.getDynamicRules();
            await browser.declarativeNetRequest.updateDynamicRules({removeRuleIds: current.map(rule => rule.id)});
            const statuses = await Promise.all(Array.from({length: 3}, () => browser.runtime.sendMessage({type: 'ensure-redirect-rules'})));
            const repaired = await browser.declarativeNetRequest.getDynamicRules();
            const stale = repaired.map(rule => rule.action.type === 'redirect' ? {...rule, action: {...rule.action, redirect: {regexSubstitution: 'webkit-extension://old/resolve.html#\\\\0'}}} : rule);
            await browser.declarativeNetRequest.updateDynamicRules({removeRuleIds: repaired.map(rule => rule.id), addRules: stale});
            const updated = await browser.runtime.sendMessage({type: 'ensure-redirect-rules'});
            const final = await browser.declarativeNetRequest.getDynamicRules();
            return statuses.every(status => status?.ready) && updated?.ready && final.length === 8 && final.filter(rule => rule.action.type === 'redirect').every(rule => rule.action.redirect.regexSubstitution.startsWith(browser.runtime.getURL('resolve.html')));
            """, arguments: [:], in: nil, contentWorld: .page)
          guard result as? Bool == true else {
            throw NSError(
              domain: "GolinkLifecycle", code: 1,
              userInfo: [NSLocalizedDescriptionKey: "Rule repair or origin reconciliation failed"])
          }
          print("PASS concurrent popup repair and persisted-origin reconciliation")
          finishLifecycle(.success(()))
        } catch { finishLifecycle(.failure(error)) }
      }
      return
    }
    if ordinarySearch {
      fail("Ordinary search loaded from the network; the harness must stay offline")
    }
  }

  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: any Error
  ) {
    if ordinarySearch {
      // The request left WebKit for the refusing proxy with its original URL: no rule redirected it.
      let failure = error as NSError
      guard failure.domain == NSURLErrorDomain,
        failure.userInfo[NSURLErrorFailingURLErrorKey] as? URL == ordinaryURL
      else {
        fail("Ordinary search did not keep its original URL: \(failure.localizedDescription)")
      }
      print("PASS ordinary Google search is not intercepted and keeps its original query")
      exit(0)
    }
    finishLifecycle(.failure(error))
  }

  private func fail(_ message: String) -> Never {
    print("FAIL \(message)")
    exit(1)
  }
}

setbuf(stdout, nil)
let application = NSApplication.shared
Task { @MainActor in
  do { try await WebKitSmoke().run() } catch {
    print("FAIL WebKit harness: \(error.localizedDescription)")
    exit(1)
  }
}
application.run()
