import SwiftUI

#if !DEBUG
  #error(
    "Production account composition and release gates are not implemented yet. Do not archive development storage."
  )
#endif

@main @MainActor struct FoldingApp: App {
  @State private var controller = AppController()
  @Environment(\.scenePhase) private var scenePhase

  var body: some Scene {
    WindowGroup {
      FoldingRootView(model: controller.presentation, actions: controller.actions)
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
        .onChange(of: scenePhase) { _, phase in
          if phase == .active { Task { await controller.refreshVisible() } }
        }
    }
  }
}
