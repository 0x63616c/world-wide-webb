import CoreTransferable
import FoldingData
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct DiagnosticsScreen: View {
  let load: () async throws -> TrackingDiagnosticSnapshot
  let clear: (() async throws -> Void)?
  let check: (() async throws -> Void)?
  @State private var report: TrackingDiagnosticSnapshot?
  @State private var busy = false
  @State private var failed = false
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(\.displayScale) private var displayScale
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    GeometryReader { geometry in
      VStack(spacing: 12) {
        HStack {
          if let check {
            Button(String(localized: "diagnostics.check", defaultValue: "Check connection")) {
              Task { await update(action: check) }
            }
            .buttonStyle(.bordered)
          }
          Spacer()
          Button {
            Task { await update() }
          } label: {
            Image(systemName: "arrow.clockwise")
          }
          .accessibilityLabel(
            String(localized: "diagnostics.refresh", defaultValue: "Refresh report"))
          Menu {
            Button(String(localized: "diagnostics.copy", defaultValue: "Copy report")) {
              UIPasteboard.general.string = export(size: geometry.size)
            }
            ShareLink(
              item: DiagnosticReportExport(snapshot: completeSnapshot(size: geometry.size)),
              preview: SharePreview(
                String(localized: "diagnostics.title", defaultValue: "Diagnostics"))
            ) {
              Text(String(localized: "diagnostics.share", defaultValue: "Share report"))
            }
            if let clear {
              Button(
                String(localized: "diagnostics.clear", defaultValue: "Clear logs"),
                role: .destructive
              ) {
                Task { await update(action: clear) }
              }
            }
          } label: {
            Image(systemName: "ellipsis.circle")
          }
          .disabled(report == nil)
          .accessibilityLabel(String(localized: "diagnostics.title", defaultValue: "Diagnostics"))
        }
        .disabled(busy)
        if busy { ProgressView() }
        if failed {
          Text(String(localized: "error.tryAgain", defaultValue: "Something went wrong."))
        }
        ScrollView {
          Text(export(size: geometry.size))
            .font(.system(.caption, design: .monospaced))
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.background.secondary, in: .rect(cornerRadius: 12))
        .refreshable { await update() }
        .accessibilityIdentifier("diagnostics.report")
      }
      .padding()
      .task { await update() }
      .navigationTitle(String(localized: "diagnostics.title", defaultValue: "Diagnostics"))
      .navigationBarTitleDisplayMode(.inline)
    }
  }

  private func completeSnapshot(size: CGSize) -> TrackingDiagnosticSnapshot {
    var snapshot = report ?? TrackingDiagnosticSnapshot(capturedAtMS: 0)
    snapshot.context.merge([
      "viewport_points": "\(Int(size.width))x\(Int(size.height))",
      "display_scale": String(describing: displayScale),
      "dynamic_type": String(describing: dynamicTypeSize),
      "scene_phase": String(describing: scenePhase),
      "appearance": String(describing: colorScheme),
    ]) { _, new in new }
    return snapshot
  }

  private func export(size: CGSize) -> String { (try? completeSnapshot(size: size).json()) ?? "" }

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

struct DiagnosticReportExport: Transferable, Sendable {
  let snapshot: TrackingDiagnosticSnapshot

  static var transferRepresentation: some TransferRepresentation {
    FileRepresentation(exportedContentType: .json) { value in
      SentTransferredFile(try value.fileURL())
    }
  }

  func fileURL() throws -> URL {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = Calendar(identifier: .iso8601)
    formatter.dateFormat = "yyyy-MM-dd-HHmmss"
    let timestamp = formatter.string(
      from: Date(timeIntervalSince1970: Double(snapshot.capturedAtMS) / 1000))
    let allowed = Set("0123456789.")
    let version = (snapshot.context["marketing_version"] ?? "unknown").filter {
      allowed.contains($0)
    }
    let build = (snapshot.context["build_number"] ?? "unknown").filter(\.isNumber)
    let name =
      "Folding-Diagnostics-v\(version.isEmpty ? "unknown" : version)-b\(build.isEmpty ? "unknown" : build)-\(timestamp).json"
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
      "FoldingDiagnostics", isDirectory: true
    )
    .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let url = directory.appendingPathComponent(name)
    try Data(snapshot.json().utf8).write(to: url, options: [.atomic, .completeFileProtection])
    return url
  }
}
