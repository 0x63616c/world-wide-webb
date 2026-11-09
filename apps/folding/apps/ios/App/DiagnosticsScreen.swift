import SwiftUI
import UIKit

struct DiagnosticsScreen: View {
  let load: () async throws -> String
  let clear: (() async throws -> Void)?
  let check: (() async throws -> Void)?
  @State private var report = ""
  @State private var busy = false
  @State private var failed = false
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(\.displayScale) private var displayScale
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    GeometryReader { geometry in
      Form {
        Section {
          if let check {
            Button(String(localized: "diagnostics.check", defaultValue: "Check connection")) {
              Task { await update(action: check) }
            }
          }
          Button(String(localized: "diagnostics.copy", defaultValue: "Copy report")) {
            UIPasteboard.general.string = completeReport(size: geometry.size)
          }.disabled(report.isEmpty)
          ShareLink(item: completeReport(size: geometry.size)) {
            Text(String(localized: "diagnostics.share", defaultValue: "Share report"))
          }.disabled(report.isEmpty)
          if let clear {
            Button(
              String(localized: "diagnostics.clear", defaultValue: "Clear logs"), role: .destructive
            ) {
              Task { await update(action: clear) }
            }
          }
        }.disabled(busy)
        if busy { ProgressView() }
        if failed {
          Text(String(localized: "error.tryAgain", defaultValue: "Something went wrong."))
        }
        Section {
          Text(completeReport(size: geometry.size))
            .font(.system(.caption, design: .monospaced))
            .textSelection(.enabled)
        }
      }
      .refreshable { await update() }
      .task { await update() }
      .navigationTitle(String(localized: "diagnostics.title", defaultValue: "Diagnostics"))
      .navigationBarTitleDisplayMode(.inline)
    }
  }

  private func completeReport(size: CGSize) -> String {
    [
      "viewport_points=\(Int(size.width))x\(Int(size.height))",
      "display_scale=\(displayScale)",
      "dynamic_type=\(String(describing: dynamicTypeSize))",
      "scene_phase=\(String(describing: scenePhase))",
      "appearance=\(String(describing: colorScheme))",
      report,
    ].joined(separator: "\n")
  }

  private func update(action: (() async throws -> Void)? = nil) async {
    guard !busy else { return }
    busy = true
    defer { busy = false }
    do {
      try await action?()
      report = try await load()
      failed = false
    } catch is CancellationError {} catch {
      failed = true
      // Keep the last report available even if a manual connection check fails.
      if let latest = try? await load() { report = latest }
    }
  }
}
