import CloudKit
import CoreData
import StoreKit
import SwiftUI

#if !DEBUG
  #error(
    "Production account composition and release gates are not implemented yet. Do not archive development storage."
  )
#endif

@main @MainActor struct FoldingApp: App {
  @State private var controller = AppController()
  @Environment(\.requestReview) private var requestReview
  @Environment(\.scenePhase) private var scenePhase

  var body: some Scene {
    WindowGroup {
      FoldingRootView(model: controller.presentation, actions: controller.actions)
        .task { TipStore.shared.start() }
        .task { await controller.synchronizePrivateHistory() }
        .onReceive(NotificationCenter.default.publisher(for: .CKAccountChanged)) { _ in
          Task { await controller.cloudAccountChanged() }
        }
        .onReceive(
          NotificationCenter.default.publisher(
            for: NSPersistentCloudKitContainer.eventChangedNotification)
        ) { _ in
          Task { await controller.synchronizePrivateHistory() }
        }
        .task { await controller.watch() }
        .task(id: [
          controller.presentation.analytics?.range.endMS, controller.presentation.analytics?.asOfMS,
        ]) {
          await controller.refreshAtDayBoundary()
        }
        .onReceive(
          NotificationCenter.default.publisher(for: UIApplication.significantTimeChangeNotification)
        ) { _ in
          Task { await controller.refreshVisible() }
        }
        .task(id: controller.presentation.setup?.attemptID) {
          await controller.observeSetupAttempt()
        }
        .onChange(of: controller.presentation.historyLoading) { _, loading in
          if !loading, scenePhase == .active, controller.claimReviewRequest() { requestReview() }
        }
        .onChange(of: scenePhase) { _, phase in
          if phase == .active {
            Task {
              await controller.synchronizePrivateHistory()
              await controller.refreshVisible()
            }
          }
        }
    }
  }
}
