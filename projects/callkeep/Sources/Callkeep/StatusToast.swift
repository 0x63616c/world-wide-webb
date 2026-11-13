import AppKit
import QuartzCore
import SwiftUI

enum OverlayPosition: String, CaseIterable, Identifiable {
  case top, bottom
  var id: Self { self }
  var title: String { self == .top ? "Top" : "Bottom" }
  static var current: Self {
    get { Self(rawValue: UserDefaults.standard.string(forKey: "overlayPosition") ?? "") ?? .top }
    set { UserDefaults.standard.set(newValue.rawValue, forKey: "overlayPosition") }
  }
  @MainActor func frame(for size: NSSize, on screen: NSScreen) -> NSRect {
    let visible = screen.visibleFrame
    return NSRect(
      x: visible.midX - size.width / 2,
      y: self == .top ? visible.maxY - size.height - 20 : visible.minY + 20,
      width: size.width, height: size.height)
  }
}

@MainActor
enum OverlayMotion {
  static func show(_ panel: NSPanel) {
    guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else {
      panel.orderFrontRegardless()
      return
    }
    let destination = panel.frame
    panel.setFrame(
      destination.offsetBy(dx: 0, dy: OverlayPosition.current == .top ? 12 : -12), display: false)
    panel.alphaValue = 0
    panel.orderFrontRegardless()
    NSAnimationContext.runAnimationGroup { context in
      context.duration = 0.24
      context.timingFunction = CAMediaTimingFunction(name: .easeOut)
      panel.animator().alphaValue = 1
      panel.animator().setFrame(destination, display: true)
    }
  }
  static func hide(_ panel: NSPanel) {
    panel.ignoresMouseEvents = true
    guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else {
      panel.close()
      return
    }
    let destination = panel.frame.offsetBy(dx: 0, dy: OverlayPosition.current == .top ? 8 : -8)
    NSAnimationContext.runAnimationGroup { context in
      context.duration = 0.18
      context.timingFunction = CAMediaTimingFunction(name: .easeIn)
      panel.animator().alphaValue = 0
      panel.animator().setFrame(destination, display: true)
    } completionHandler: {
      panel.close()
    }
  }
}

@MainActor
final class StatusToast {
  static let shared = StatusToast()
  private var panel: NSPanel?
  private var dismissal: Task<Void, Never>?
  func updatePosition() {
    guard let panel, let screen = panel.screen ?? NSScreen.main else { return }
    panel.setFrame(OverlayPosition.current.frame(for: panel.frame.size, on: screen), display: true)
  }
  func show(_ message: String, recording: Bool, action: (() -> Void)? = nil) {
    dismissal?.cancel()
    if let panel { OverlayMotion.hide(panel) }
    guard let screen = NSScreen.main else { return }
    let panel = NSPanel(
      contentRect: OverlayPosition.current.frame(for: NSSize(width: 260, height: 54), on: screen),
      styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.level = .floating
    panel.hidesOnDeactivate = false
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    panel.ignoresMouseEvents = action == nil
    panel.contentView = NSHostingView(
      rootView:
        Button {
          action?()
          self.dismissal?.cancel()
          if let panel = self.panel { OverlayMotion.hide(panel) }
          self.panel = nil
        } label: {
          HStack(spacing: 10) {
            Image(systemName: recording ? "record.circle.fill" : "checkmark.circle.fill")
              .foregroundStyle(recording ? Color.red : Color.green)
            Text(message).font(.system(size: 14, weight: .medium))
          }.frame(maxWidth: .infinity, maxHeight: .infinity).background(
            .regularMaterial, in: Capsule())
        }.buttonStyle(.plain).help(action == nil ? message : "Open recording")
    )
    OverlayMotion.show(panel)
    self.panel = panel
    dismissal = Task { [weak self] in
      try? await Task.sleep(for: .seconds(action == nil ? 2.4 : 5))
      guard !Task.isCancelled else { return }
      if let panel = self?.panel { OverlayMotion.hide(panel) }
      self?.panel = nil
    }
  }
}

@MainActor
final class RecordingIndicator {
  static let shared = RecordingIndicator()
  private var panel: NSPanel?

  func updatePosition() {
    guard let panel, let screen = panel.screen ?? NSScreen.main else { return }
    panel.setFrame(OverlayPosition.current.frame(for: panel.frame.size, on: screen), display: true)
  }

  func show(model: AppModel) {
    guard panel == nil, let screen = NSScreen.main ?? NSScreen.screens.first else { return }
    let size = NSSize(width: 112, height: 50)
    let panel = NSPanel(
      contentRect: OverlayPosition.current.frame(for: size, on: screen),
      styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.level = .floating
    panel.isFloatingPanel = true
    panel.hidesOnDeactivate = false
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    panel.contentView = NSHostingView(rootView: RecordingIndicatorView(model: model).padding(4))
    self.panel = panel
    OverlayMotion.show(panel)
  }

  func hide() {
    if let panel { OverlayMotion.hide(panel) }
    panel = nil
  }
}

struct RecordingIndicatorView: View {
  let model: AppModel
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  var body: some View {
    HStack(spacing: 9) {
      Circle().fill(.red).frame(width: 7, height: 7)
      HStack(spacing: 2) {
        ForEach(0..<7) { index in
          let level = index.isMultiple(of: 2) ? model.micLevel : model.systemLevel
          Capsule().fill(index.isMultiple(of: 2) ? VoiceColor.microphone : VoiceColor.systemAudio)
            .frame(
              width: 3,
              height: min(18, 4 + CGFloat(sqrt(max(0, min(level, 1)))) * (12 + CGFloat(index % 3)))
            )
            .animation(reduceMotion ? nil : .easeOut(duration: 0.1), value: level)
        }
      }.frame(height: 18).accessibilityHidden(true)
      Button {
        model.stopRecording()
      } label: {
        Image(systemName: "stop.fill").font(.system(size: 9, weight: .bold))
          .frame(width: 22, height: 22).background(.white.opacity(0.16), in: Circle())
      }.buttonStyle(.plain).help("Stop recording").accessibilityLabel("Stop recording")
    }
    .foregroundStyle(.white)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.black.opacity(0.94), in: Capsule())
    .overlay {
      TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { context in
        let angle =
          reduceMotion
          ? 0 : context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 8) * 45
        Capsule().strokeBorder(
          AngularGradient(
            colors: [VoiceColor.microphone, VoiceColor.systemAudio, VoiceColor.microphone],
            center: .center, angle: .degrees(angle)), lineWidth: 1.5)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Recording")
  }
}
