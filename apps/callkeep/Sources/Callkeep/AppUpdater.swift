import AppKit
import Combine
import Observation
import Sparkle

@MainActor
final class AppUpdater: NSObject, ObservableObject, SPUUpdaterDelegate {
    @Published private(set) var canCheckForUpdates = false
    @Published private(set) var updateAvailable = false
    @Published var automaticallyChecksForUpdates = true {
        didSet {
            guard let controller, controller.updater.automaticallyChecksForUpdates != automaticallyChecksForUpdates else { return }
            controller.updater.automaticallyChecksForUpdates = automaticallyChecksForUpdates
        }
    }
    private let model: AppModel
    private var controller: SPUStandardUpdaterController!
    private var observation: AnyCancellable?
    private var automaticCheckObservation: AnyCancellable?
    private var postponedInstallation: (() -> Void)?

    init(model: AppModel) {
        self.model = model
        super.init()
        controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: self, userDriverDelegate: nil)
        observation = controller.updater.publisher(for: \.canCheckForUpdates)
            .receive(on: RunLoop.main)
            .sink { [weak self] in self?.canCheckForUpdates = $0 }
        automaticallyChecksForUpdates = controller.updater.automaticallyChecksForUpdates
        automaticCheckObservation = controller.updater.publisher(for: \.automaticallyChecksForUpdates)
            .receive(on: RunLoop.main)
            .sink { [weak self] value in
                if self?.automaticallyChecksForUpdates != value { self?.automaticallyChecksForUpdates = value }
            }
        observeCaptureState()
        #if DEBUG
        if Bundle.main.object(forInfoDictionaryKey: "CallkeepScreenshotUpdateAvailable") as? Bool == true { updateAvailable = true }
        #endif
        // Local builds stay local unless an explicit updater test opts in.
        if AppIdentity.isProduction || Bundle.main.object(forInfoDictionaryKey: "CallkeepEnableUpdaterInDebug") as? Bool == true {
            controller.startUpdater()
            // Sparkle recommends forcing a launch check only immediately after
            // startup, leaving subsequent checks to its own scheduler.
            if controller.updater.automaticallyChecksForUpdates {
                controller.updater.checkForUpdatesInBackground()
            }
        }
    }

    func checkForUpdates() { controller.checkForUpdates(nil) }

    func updater(_ updater: SPUUpdater, didFindValidUpdate item: SUAppcastItem) {
        updateAvailable = true
        AppLog.shared.record(.updateAvailable)
    }

    func updaterDidNotFindUpdate(_ updater: SPUUpdater) {
        updateAvailable = false
        AppLog.shared.record(.updateNotFound)
    }

    func updater(_ updater: SPUUpdater, didAbortWithError error: Error) {
        AppLog.shared.record(.updateFailed, error: error)
    }

    func updater(_ updater: SPUUpdater, mayPerform updateCheck: SPUUpdateCheck) throws {
        guard !model.isRecording, !model.isBusy else {
            throw NSError(domain: "co.calum.callkeep.updates", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Updates can be checked after the recording or file operation finishes."])
        }
    }

    func updater(_ updater: SPUUpdater, shouldProceedWithUpdate updateItem: SUAppcastItem, updateCheck: SPUUpdateCheck) throws {
        try self.updater(updater, mayPerform: updateCheck)
    }

    func updater(_ updater: SPUUpdater, shouldPostponeRelaunchForUpdate item: SUAppcastItem,
                 untilInvokingBlock installHandler: @escaping () -> Void) -> Bool {
        postponeInstallationIfNeeded(installHandler)
    }

    func postponeInstallationIfNeeded(_ installHandler: @escaping () -> Void) -> Bool {
        guard model.isRecording || model.isBusy else { return false }
        postponedInstallation = installHandler
        return true
    }

    private func observeCaptureState() {
        withObservationTracking {
            _ = model.isRecording
            _ = model.isBusy
        } onChange: { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                self.observeCaptureState()
                if !self.model.isRecording, !self.model.isBusy, let install = self.postponedInstallation {
                    self.postponedInstallation = nil
                    install()
                }
            }
        }
    }
}
