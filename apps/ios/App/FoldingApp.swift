import CloudKit
import CoreData
import StoreKit
import SwiftUI

@main @MainActor struct FoldingApp: App {
  @UIApplicationDelegateAdaptor(FoldingPushAppDelegate.self) private var pushDelegate
  @State private var controller = AppController()
  @Environment(\.requestReview) private var requestReview
  @Environment(\.scenePhase) private var scenePhase

  init() {
    #if !targetEnvironment(simulator)
      precondition(
        !ProcessInfo.processInfo.arguments.contains { $0.hasPrefix("--folding-screenshot-") },
        "Screenshot fixtures are not available in device builds")
    #endif
  }

  var body: some Scene {
    WindowGroup {
      #if DEBUG
        if CloudKitSchemaBootstrapView.requested {
          CloudKitSchemaBootstrapView()
        } else {
          trackingContent
        }
      #else
        trackingContent
      #endif
    }
  }

  private var trackingContent: some View {
    FoldingRootView(model: controller.presentation, actions: controller.actions)
      .task { controller.attachPushDelegate(pushDelegate) }
      .task { TipStore.shared.start() }
      .task { await controller.restoreCompetition() }
      .task { await controller.maintainCompetitionUploads() }
      .task(id: controller.presentation.competitionRemoval) { await controller.watchRemoval() }
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
