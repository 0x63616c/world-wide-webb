import SafariServices

// The extension has no native messaging or credential/data bridge.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
  func beginRequest(with context: NSExtensionContext) {
    context.completeRequest(returningItems: nil)
  }
}
