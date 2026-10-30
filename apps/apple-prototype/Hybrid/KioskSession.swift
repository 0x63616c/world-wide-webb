import AVFoundation
import Observation
import UIKit
import WebKit

@MainActor @Observable
final class KioskSession {
    let configuration: PanelConfiguration
    private(set) var generation = 0
    private(set) var reconnecting = false
    var browser: BrowserDestination?
    var share: ShareDestination?
    let launchedAt: Int64

    @ObservationIgnored weak var webView: WKWebView?
    @ObservationIgnored private let alarms: PanelAlarms
    @ObservationIgnored private var watchdog: Task<Void, Never>?
    @ObservationIgnored private var reload: Task<Void, Never>?
    @ObservationIgnored private var failedBoots = 0
    @ObservationIgnored private var rendered = false
    @ObservationIgnored private var pendingAlarms = false

    init(configuration: PanelConfiguration, alarms: PanelAlarms = PanelAlarms()) {
        self.configuration = configuration
        self.alarms = alarms
        launchedAt = Int64(Date().timeIntervalSince1970 * 1000)
        alarms.configure(serverURL: configuration.serverURL, token: configuration.alarmAPIToken,
                         cfID: configuration.cfAccessClientID, cfSecret: configuration.cfAccessClientSecret)
    }

    func activate() {
        UIApplication.shared.isIdleTimerDisabled = true
        UIDevice.current.isBatteryMonitoringEnabled = true
        // Equivalent to Expo's playsInSilentMode; WebKit owns media playback.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        Task { await alarms.refresh() }
    }

    func startBoot() {
        rendered = false
        watchdog?.cancel()
        let expectedGeneration = generation
        let timeout = KioskBoot.timeout(attempt: failedBoots)
        watchdog = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(timeout)) } catch { return }
            guard let self, self.generation == expectedGeneration else { return }
            self.recover()
        }
    }

    func receive(_ report: BootReport) {
        watchdog?.cancel()
        watchdog = nil
        if report.rendered {
            reload?.cancel()
            reload = nil
            failedBoots = 0
            rendered = true
            reconnecting = false
            deliverPendingAlarms()
        } else { recover() }
    }

    func recover() {
        watchdog?.cancel()
        watchdog = nil
        rendered = false
        reconnecting = true
        guard reload == nil else { return }
        let delay = KioskBoot.recoveryDelay(attempt: failedBoots)
        reload = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(delay)) } catch { return }
            guard let self else { return }
            self.reload = nil
            self.failedBoots = min(self.failedBoots + 1, 30)
            self.generation += 1
        }
    }

    func stop() {
        watchdog?.cancel()
        watchdog = nil
        reload?.cancel()
        reload = nil
        webView = nil
        UIApplication.shared.isIdleTimerDisabled = false
    }

    func open(_ url: URL) {
        guard url.absoluteString == "controlcenter://alarms" else { return }
        pendingAlarms = true
        deliverPendingAlarms()
    }

    private func deliverPendingAlarms() {
        // Waiting for #root, rather than didFinish, also handles a cold deep link
        // while the web bundle is still downloading or recovering.
        guard pendingAlarms, rendered, let webView,
              KioskURLPolicy.isTrusted(webView.url, serverURL: configuration.serverURL) else { return }
        pendingAlarms = false
        webView.evaluateJavaScript(KioskScripts.openAlarms, completionHandler: nil)
    }

    func openBrowser(_ url: URL) {
        guard share == nil else { return }
        browser = BrowserDestination(url: url)
    }

    func handle(_ request: NativeRequest, in webView: WKWebView) async -> NativeResponse {
        func fail(_ message: String) -> NativeResponse { .failure(id: request.id, message: message) }
        switch request.method {
        case "deviceInfo":
            return .success(id: request.id, result: .object([
                "model": .string(Self.hardwareModel),
                "identifier": .string(UIDevice.current.identifierForVendor?.uuidString ?? "")
            ]))
        case "batteryInfo":
            let device = UIDevice.current
            device.isBatteryMonitoringEnabled = true
            return .success(id: request.id, result: .object([
                "batteryLevel": device.batteryLevel < 0 ? .null : .number(Double(device.batteryLevel)),
                "isCharging": .bool(device.batteryState == .charging || device.batteryState == .full)
            ]))
        case "setBrightness":
            guard let level = BridgeParameters.brightness(request.params) else { return fail("Missing brightness level") }
            guard let screen = webView.window?.windowScene?.screen else { return fail("Panel screen unavailable") }
            screen.brightness = CGFloat(level)
        case "share":
            guard let raw = request.params?["url"]?.string, let url = KioskURLPolicy.httpURL(raw) else {
                return fail("Missing or invalid share URL")
            }
            guard browser == nil, share == nil else { return fail("Close the current sheet before sharing") }
            share = ShareDestination(url: url)
        case "openBrowser":
            guard let raw = request.params?["url"]?.string, let url = KioskURLPolicy.httpURL(raw) else {
                return fail("Missing or invalid browser URL")
            }
            guard share == nil else { return fail("Close the share sheet before opening the browser") }
            openBrowser(url)
        case "closeBrowser": browser = nil
        case "syncNextAlarm":
            do { try await alarms.sync(next: request.params?["next"] ?? .null) }
            catch { return fail("Could not sync the next alarm") }
        default: return fail("Unknown native method: \(request.method)")
        }
        return .success(id: request.id)
    }

    private static var hardwareModel: String {
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { bytes in
            String(decoding: bytes.prefix(while: { $0 != 0 }), as: UTF8.self)
        }
    }
}

struct BrowserDestination: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

struct ShareDestination: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}
