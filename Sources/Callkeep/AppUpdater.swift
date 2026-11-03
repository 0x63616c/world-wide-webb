import AppKit
import Combine
import Observation
import Sparkle

@MainActor
final class AppUpdater: NSObject, ObservableObject, SPUUpdaterDelegate {
    @Published private(set) var canCheckForUpdates = false
    private let model: AppModel
    private var controller: SPUStandardUpdaterController!
    private var observation: AnyCancellable?
    private var postponedInstallation: (() -> Void)?

    init(model: AppModel) {
        self.model = model
        super.init()
        controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: self, userDriverDelegate: nil)
        observation = controller.updater.publisher(for: \.canCheckForUpdates)
            .receive(on: RunLoop.main)
            .sink { [weak self] in self?.canCheckForUpdates = $0 }
        observeCaptureState()
        // Local builds stay local unless an explicit updater test opts in.
        if AppIdentity.isProduction || Bundle.main.object(forInfoDictionaryKey: "CallkeepEnableUpdaterInDebug") as? Bool == true {
            controller.startUpdater()
        }
    }

    func checkForUpdates() { controller.checkForUpdates(nil) }

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
