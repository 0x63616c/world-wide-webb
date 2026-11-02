import SwiftUI
import UIKit
import PanelKit

/// Attached once to this scene's window, never to a tile or face.
struct PanelDiagnosticsAccess: UIViewRepresentable {
    let store: LiveHomeDataSource
    func makeUIView(context: Context) -> AttachmentView {
        let view = AttachmentView(open: {})
        view.open = { [weak view] in view?.presentDiagnostics(store: store) }
        return view
    }
    func updateUIView(_ view: AttachmentView, context: Context) {
        view.open = { [weak view] in view?.presentDiagnostics(store: store) }
    }
    static func dismantleUIView(_ view: AttachmentView, coordinator: ()) { view.detach() }

    final class AttachmentView: UIView, UIGestureRecognizerDelegate {
        var open: () -> Void
        private weak var installedWindow: UIWindow?
        private(set) var recognizer = UILongPressGestureRecognizer()
        init(open: @escaping () -> Void) {
            self.open = open
            super.init(frame: .zero)
            recognizer.numberOfTouchesRequired = 3
            recognizer.minimumPressDuration = 1.5
            recognizer.cancelsTouchesInView = false
            recognizer.delegate = self
            recognizer.addTarget(self, action: #selector(pressed))
        }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        override func didMoveToWindow() {
            super.didMoveToWindow()
            detach()
            installedWindow = window
            window?.addGestureRecognizer(recognizer)
        }
        func detach() { installedWindow?.removeGestureRecognizer(recognizer); installedWindow = nil }
        // Present from this window's visible controller so the gesture also works
        // over a module's full-screen cover. Never look up another scene's window.
        func presentDiagnostics(store: LiveHomeDataSource) {
            guard var presenter = window?.rootViewController else { return }
            while let presented = presenter.presentedViewController {
                if presented.restorationIdentifier == "panel-diagnostics" { return }
                presenter = presented
            }
            let controller = UIHostingController(rootView: AnyView(EmptyView()))
            controller.restorationIdentifier = "panel-diagnostics"
            controller.modalPresentationStyle = .fullScreen
            controller.rootView = AnyView(PanelDiagnosticsView(store: store) { [weak controller] in
                controller?.dismiss(animated: true)
            })
            presenter.present(controller, animated: true)
        }
        @objc private func pressed() { if recognizer.state == .began { open() } }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }
    }
}

struct PanelDiagnosticsView: View {
    let store: LiveHomeDataSource
    let close: () -> Void
    @State private var backend = "checking"
    @State private var latencyMs: Int?
    @State private var homeAssistant = "unknown"
    @State private var commands: [PanelCommandLog.Entry] = []
    @State private var sending = false
    @State private var result: String?
    private var source: String {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-hybridFixtures") { return "fixture" }
        #endif
        return "live"
    }
    private var build: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "dev" }
    private var gitSHA: String {
        let value = Bundle.main.object(forInfoDictionaryKey: "PanelGitSHA") as? String ?? "dev"
        return value.isEmpty || value.hasPrefix("$(") ? "dev" : value
    }
    private var snapshot: PanelDiagnosticsSnapshot {
        PanelDiagnosticsSnapshot(source: source, backendURL: store.diagnosticsBackendURL,
            build: build, gitSHA: gitSHA, backend: backend, latencyMs: latencyMs, homeAssistant: homeAssistant)
    }
    var body: some View {
        NavigationStack {
            List {
                Section("Panel") {
                    LabeledContent("Data source", value: source)
                    LabeledContent("Backend URL", value: store.diagnosticsBackendURL)
                    LabeledContent("Build", value: build)
                    LabeledContent("Git SHA", value: gitSHA)
                }
                Section("Live connection check") {
                    LabeledContent("Backend", value: backend)
                    if let latencyMs { LabeledContent("Ping latency", value: "\(latencyMs) ms") }
                    LabeledContent("Home Assistant", value: homeAssistant)
                    Button("Check again") { Task { await check() } }
                }
                Section("Command log (last 50)") {
                    ForEach(commands) { entry in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(entry.control).font(.headline)
                            Text(entry.payload.sorted(by: { $0.key < $1.key }).map { "\($0.key)=\($0.value)" }.joined(separator: ", "))
                            Text("\(entry.status.map(String.init) ?? "No HTTP status") · \(entry.error ?? (entry.status == nil ? "local / dispatched" : "OK")) · \(entry.latencyMs) ms")
                        }.font(.caption).textSelection(.enabled)
                    }
                }
                Section {
                    Button { Task { await send() } } label: {
                        HStack {
                            if sending { ProgressView() }
                            Text(sending ? "Sending…" : "Send logs")
                        }
                    }.disabled(sending).accessibilityIdentifier("diagnostics-send")
                    if let result { Text(result).accessibilityIdentifier("diagnostics-result") }
                }
            }
            .navigationTitle("Diagnostics")
            .toolbar { ToolbarItem(placement: .confirmationAction) {
                Button("Done", action: close).accessibilityIdentifier("diagnostics-done")
            } }
        }
        .preferredColorScheme(.dark)
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
        .accessibilityIdentifier("panel-diagnostics")
        .task { await check() }
        .onReceive(Foundation.NotificationCenter.default.publisher(for: PanelCommandLog.changedNotification).receive(on: RunLoop.main)) { _ in
            commands = PanelCommandLog.shared.snapshot()
        }
    }
    private struct Ping: Decodable, Sendable { let status: String; let timestamp: Double }
    private struct Health: Decodable, Sendable { let homeAssistant: String }
    private struct Receipt: Decodable, Sendable { let accepted: Bool }
    @MainActor private func check() async {
        commands = PanelCommandLog.shared.snapshot()
        backend = "checking"; homeAssistant = "unknown"; latencyMs = nil
        let started = Date()
        do {
            _ = try await store.diagnosticsClient.query("health.ping", as: Ping.self)
            latencyMs = Int(Date().timeIntervalSince(started) * 1000)
            backend = "reachable"
        } catch { backend = "unreachable"; return }
        do {
            let health = try await store.diagnosticsClient.query("diagnostics.status", as: Health.self)
            homeAssistant = health.homeAssistant
        } catch { homeAssistant = "unknown" }
    }
    @MainActor private func send() async {
        sending = true; result = nil
        defer { sending = false }
        commands = PanelCommandLog.shared.snapshot()
        do {
            let receipt = try await store.diagnosticsClient.mutation("diagnostics.submit",
                input: PanelDiagnosticsSubmission(snapshot: snapshot, commands: commands), as: Receipt.self)
            result = receipt.accepted ? "Logs sent." : "Could not send logs. Try again."
        } catch { result = "Could not send logs. Check the connection and try again." }
    }
}
