import AppKit
import SwiftUI

/// A nonactivating companion: System Settings keeps focus during the file drag.
@MainActor
final class PermissionCompanion {
  static let shared = PermissionCompanion()
  private var panel: NSPanel?
  private var monitoring: Task<Void, Never>?
  private var lastSettingsFrame: CGRect?

  func show(permissions: Permissions, kind: Permissions.Kind) {
    dismiss()
    permissions.refresh()
    guard !permissions.isAllowed(kind) else { return }
    let panel = NSPanel(
      contentRect: NSRect(x: 0, y: 0, width: 304, height: 192),
      styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.identifier = NSUserInterfaceItemIdentifier("permission-companion")
    panel.title = "Callkeep — Permission Setup"
    panel.level = .floating
    panel.becomesKeyOnlyIfNeeded = true
    panel.hidesOnDeactivate = false
    panel.isReleasedWhenClosed = false
    panel.isMovableByWindowBackground = true
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.contentView = NSHostingView(
      rootView: PermissionCompanionView(
        permissions: permissions, kind: kind, dismiss: { [weak self] in self?.dismiss() }))
    self.panel = panel
    position(panel)
    panel.orderFrontRegardless()
    monitoring = Task { @MainActor [weak self] in
      while !Task.isCancelled {
        permissions.refresh()
        guard let self, let panel = self.panel else { return }
        if permissions.isAllowed(kind) {
          try? await Task.sleep(for: .seconds(1))
          if !Task.isCancelled { self.dismiss() }
          return
        }
        // Follow Settings without requiring Accessibility or screen pixels.
        guard self.position(panel) else {
          self.dismiss()
          return
        }
        let front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        if front == "com.apple.systempreferences" || front == Bundle.main.bundleIdentifier {
          panel.orderFrontRegardless()
        } else {
          panel.orderOut(nil)
        }
        do { try await Task.sleep(for: .milliseconds(750)) } catch { return }
      }
    }
  }

  func dismiss() {
    monitoring?.cancel()
    monitoring = nil
    panel?.orderOut(nil)
    panel = nil
    lastSettingsFrame = nil
  }

  @discardableResult
  private func position(_ panel: NSPanel) -> Bool {
    let settingsPID = NSRunningApplication.runningApplications(
      withBundleIdentifier: "com.apple.systempreferences"
    ).first?.processIdentifier
    let windows =
      CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
      as? [[String: Any]] ?? []
    let bounds =
      windows.first { window in
        (window[kCGWindowOwnerPID as String] as? Int32) == settingsPID
          && (window[kCGWindowLayer as String] as? Int) == 0
      }?[kCGWindowBounds as String] as? [String: CGFloat]
    let target: CGRect? = bounds.flatMap { values in
      guard let x = values["X"], let y = values["Y"], let w = values["Width"],
        let h = values["Height"], w > 200, h > 200
      else { return nil }
      return CGRect(x: x, y: (NSScreen.screens.first?.frame.maxY ?? 0) - y - h, width: w, height: h)
    }
    if let target, target == lastSettingsFrame { return true }
    if target == nil && lastSettingsFrame != nil { return false }
    if target == nil && panel.isVisible { return true }
    lastSettingsFrame = target
    let screen =
      NSScreen.screens.max { a, b in
        let rect = target ?? NSRect(origin: NSEvent.mouseLocation, size: .init(width: 1, height: 1))
        return area(a.visibleFrame.intersection(rect)) < area(b.visibleFrame.intersection(rect))
      } ?? NSScreen.main
    guard let visible = screen?.visibleFrame else { return true }
    let size = panel.frame.size
    var x = visible.maxX - size.width - 20
    var y = visible.minY + 24
    if let target {
      x = target.minX - size.width - 16
      if x < visible.minX + 12 { x = target.maxX + 16 }
      if x + size.width > visible.maxX - 12 { x = target.minX + 16 }
      y = target.minY + 16
    }
    x = min(max(x, visible.minX + 12), visible.maxX - size.width - 12)
    y = min(max(y, visible.minY + 12), visible.maxY - size.height - 12)
    panel.setFrameOrigin(NSPoint(x: x, y: y))
    return true
  }
  private func area(_ rect: CGRect) -> CGFloat { rect.isNull ? 0 : rect.width * rect.height }
}

private struct PermissionCompanionView: View {
  @Bindable var permissions: Permissions
  let kind: Permissions.Kind
  let dismiss: () -> Void
  private var allowed: Bool { permissions.isAllowed(kind) }
  var body: some View {
    VStack(spacing: 14) {
      HStack {
        Text(kind == .systemAudio ? "System Audio" : "Microphone").font(
          .system(size: 12, weight: .semibold)
        ).foregroundStyle(.secondary)
        Spacer()
        Button(action: dismiss) {
          Image(systemName: "xmark").font(.system(size: 11, weight: .semibold)).frame(
            width: 22, height: 22
          ).contentShape(Circle())
        }
        .buttonStyle(.plain).accessibilityLabel("Close setup helper")
      }
      HStack(spacing: 14) {
        Image(nsImage: NSWorkspace.shared.icon(forFile: Bundle.main.bundlePath)).resizable().frame(
          width: 54, height: 54)
        VStack(alignment: .leading, spacing: 4) {
          Text("Callkeep").font(.system(size: 17, weight: .semibold))
          Text(kind == .systemAudio ? "Drag to System Settings" : "Enable in System Settings").font(
            .callout
          ).foregroundStyle(.secondary)
        }
        Spacer(minLength: 0)
      }
      .padding(10)
      .background(.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
      .overlay {
        if kind == .systemAudio {
          AppFileDragSource().accessibilityLabel("Drag Callkeep to System Settings")
        }
      }
      if allowed {
        Label("Allowed", systemImage: "checkmark.circle.fill").foregroundStyle(.green).font(
          .callout)
      } else {
        Text(
          kind == .systemAudio
            ? "Add to System Audio Recording Only, then turn on Callkeep."
            : "Turn on Callkeep in the Microphone list."
        )
        .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
      }
    }.padding(16).frame(width: 304, height: 192)
      .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
      .overlay(
        RoundedRectangle(cornerRadius: 16).strokeBorder(.primary.opacity(0.12), lineWidth: 0.5))
  }
}

private struct AppFileDragSource: NSViewRepresentable {
  func makeNSView(context: Context) -> AppFileDragView { AppFileDragView() }
  func updateNSView(_ nsView: AppFileDragView, context: Context) {}
}

private final class AppFileDragView: NSView, NSDraggingSource {
  override var mouseDownCanMoveWindow: Bool { false }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func shouldDelayWindowOrdering(for event: NSEvent) -> Bool { true }
  override func mouseDown(with event: NSEvent) { NSApp.preventWindowOrdering() }
  override func mouseDragged(with event: NSEvent) {
    NSApp.preventWindowOrdering()
    let item = NSDraggingItem(pasteboardWriter: Bundle.main.bundleURL as NSURL)
    let point = convert(event.locationInWindow, from: nil)
    let icon = NSWorkspace.shared.icon(forFile: Bundle.main.bundlePath)
    item.setDraggingFrame(
      NSRect(x: point.x - 28, y: point.y - 28, width: 56, height: 56), contents: icon)
    beginDraggingSession(with: [item], event: event, source: self)
      .animatesToStartingPositionsOnCancelOrFail = true
  }
  func draggingSession(
    _ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext
  ) -> NSDragOperation { .copy }
}
