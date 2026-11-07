import AVFoundation
import Observation
import PanelKit
import UIKit

@MainActor @Observable
final class PanelSession {
    let configuration: PanelConfiguration
    let nativeAlarms: NativeAlarmsRuntime
    @ObservationIgnored private let alarms: PanelAlarms

    init(
        configuration: PanelConfiguration, alarms: PanelAlarms = PanelAlarms(),
        nativeAlarms: NativeAlarmsRuntime = NativeAlarmsRuntime()
    ) {
        self.configuration = configuration
        self.alarms = alarms
        self.nativeAlarms = nativeAlarms
        alarms.configure(
            serverURL: configuration.serverURL, token: configuration.apiToken,
            cfID: configuration.cfAccessClientID, cfSecret: configuration.cfAccessClientSecret)
    }

    func activate() {
        UIApplication.shared.isIdleTimerDisabled = true
        UIDevice.current.isBatteryMonitoringEnabled = true
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    func stop() {
        UIApplication.shared.isIdleTimerDisabled = false
    }

    func reconcileAlarms(_ provider: LiveAlarmsProvider) async {
        await nativeAlarms.reconcile(
            snapshot: provider.snapshot, available: provider.availability == .live,
            configured: !configuration.apiToken.isEmpty || isAlarmFixture,
            syncWidget: { next in
                if self.isAlarmFixture { return }
                try await self.alarms.sync(next: next)
            })
    }

    private var isAlarmFixture: Bool {
        #if DEBUG
            ProcessInfo.processInfo.arguments.contains("-hybridFixtures")
        #else
            false
        #endif
    }
}
