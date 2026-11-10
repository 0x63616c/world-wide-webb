import AppKit
import WebKit

// Real WebKit extension engine, isolated from Safari profiles and settings.
// Only synthetic fixture queries are used. The tailnet navigation is cancelled.
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

  func run() async throws {
    let resources = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    let webExtension = try await WKWebExtension(resourceBaseURL: resources)
    guard webExtension.errors.isEmpty else { fail("Invalid extension manifest") }
    context = WKWebExtensionContext(for: webExtension)
    // This permission applies only to the nonpersistent test data store.
    context.hasAccessToPrivateData = true
    context.setPermissionStatus(.grantedExplicitly, for: .declarativeNetRequestWithHostAccess)
    for host in ["https://www.google.com/*", "https://google.com/*"] {
      context.setPermissionStatus(
        .grantedExplicitly, for: try WKWebExtension.MatchPattern(string: host))
    }
    controller = WKWebExtensionController(configuration: .nonPersistent())
    controller.delegate = self
    try controller.load(context)
    makeBrowserView()
    controller.didOpenWindow(self)
    try await context.loadBackgroundContent()
    try await Task.sleep(for: .seconds(2))
    guard context.errors.isEmpty else { fail("Safari could not install the redirect rules") }
    webView.load(
      URLRequest(url: URL(string: "https://www.google.com/search?q=go%2Frepo&client=safari")!))
    try await Task.sleep(for: .seconds(25))
    fail("Timed out waiting for WebKit redirect/search evidence")
  }

  private func makeBrowserView() {
    if let webView { previousViews.append(webView) }
    let configuration = WKWebViewConfiguration()
    configuration.webExtensionController = controller
    configuration.websiteDataStore = .nonPersistent()
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
      self.webView.load(
        URLRequest(
          url: URL(string: "https://www.google.com/search?q=go%2Frepo+explanation&client=safari")!))
      return
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard ordinarySearch, let url = webView.url, url.host == "www.google.com",
      url.path == "/search",
      let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(
        where: { $0.name == "q" })?.value,
      query.replacingOccurrences(of: "+", with: " ") == "go/repo explanation"
    else { return }
    print("PASS ordinary Google search loads with its original query")
    exit(0)
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
