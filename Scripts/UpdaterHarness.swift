// Exercise the production updater delegate with simulated capture state.
// No audio devices, network checks, or installation are started.
import AppKit
import Observation
import Sparkle

@MainActor @Observable
final class AppModel {
    var isRecording = false
    var isBusy = false
}

@main
struct UpdaterHarness {
    struct Failure: Error { let message: String }
    @MainActor static func require(_ value: Bool, _ message: String) throws {
        if !value { throw Failure(message: message) }
    }
    @MainActor static func settle() async throws { try await Task.sleep(for: .milliseconds(30)) }
    @MainActor static func main() async {
        do {
            _ = NSApplication.shared
            let model = AppModel()
            let delegate = AppUpdater(model: model)
            let controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: nil, userDriverDelegate: nil)
            model.isRecording = true
            try await settle()
            var blocked = false
            do { try delegate.updater(controller.updater, mayPerform: .updates) }
            catch { blocked = true }
            try require(blocked, "An active recording must block update checks")
            var installs = 0
            let postponed = delegate.postponeInstallationIfNeeded { installs += 1 }
            try require(postponed && installs == 0, "Installation must wait for capture to finish")
            model.isRecording = false
            model.isBusy = true
            try await settle()
            try require(installs == 0, "Finishing the file operation must also be awaited")
            model.isBusy = false
            try await settle()
            try require(installs == 1, "Becoming idle must resume the postponed install once")
            model.isBusy = true
            try await settle()
            model.isBusy = false
            try await settle()
            try require(installs == 1, "A later idle transition must not repeat installation")
            try delegate.updater(controller.updater, mayPerform: .updates)
            let idlePostponed = delegate.postponeInstallationIfNeeded { installs += 1 }
            try require(!idlePostponed && installs == 1, "Idle updates should proceed through Sparkle normally")
            print("Updater recording/IO deferral checks passed.")
        } catch {
            print("Updater checks failed: \(error)")
            exit(1)
        }
    }
}
