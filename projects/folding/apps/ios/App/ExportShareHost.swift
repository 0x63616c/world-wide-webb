import FoldingData
import FoldingDomain
import SwiftUI
import UIKit

/// No file URL survives the Settings-to-share transition. Resolve the opaque ticket only
/// on the active share surface, allowing the service to recheck account/reset validity.
struct ExportShareHost: View {
  let ticket: UUID
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @State private var file: URL?
  @State private var finished = false

  var body: some View {
    Group {
      if model.sheet == .export(ticket), let file, !finished {
        ExportShareSheet(file: file) { error in
          if error != nil, !finished, model.sheet == .export(ticket) {
            model.error = String(
              localized: "error.tryAgain", defaultValue: "Something went wrong.")
          }
          Task { await finish(dismiss: true) }
        }
      } else {
        ProgressView(String(localized: "export.progress", defaultValue: "Preparing export"))
      }
    }
    .task(id: ticket) {
      do {
        guard let resolve = actions.exportURL else { throw ExportPresentationError.unavailable }
        let resolved = try await resolve(ticket)
        guard !Task.isCancelled, !finished, model.sheet == .export(ticket) else {
          await finish(dismiss: false)
          return
        }
        file = resolved
      } catch {
        if !Task.isCancelled, !finished, model.sheet == .export(ticket) {
          model.error = String(
            localized: "error.tryAgain", defaultValue: "Something went wrong.")
        }
        await finish(dismiss: true)
      }
    }
    .onDisappear { Task { await finish(dismiss: false) } }
  }

  private func finish(dismiss: Bool) async {
    guard !finished else { return }
    finished = true
    file = nil
    if dismiss, model.sheet == .export(ticket) { model.sheet = nil }
    await actions.exportFinished?(ticket)
  }
}

private enum ExportPresentationError: Error { case unavailable }

private struct ExportShareSheet: UIViewControllerRepresentable {
  let file: URL
  let completion: (Error?) -> Void
  func makeUIViewController(context: Context) -> UIActivityViewController {
    let controller = UIActivityViewController(activityItems: [file], applicationActivities: nil)
    controller.completionWithItemsHandler = { _, _, _, error in completion(error) }
    return controller
  }
  func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
