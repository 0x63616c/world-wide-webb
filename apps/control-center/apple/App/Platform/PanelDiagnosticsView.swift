import PanelKit
import SwiftUI
import UIKit

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
        func detach() {
            installedWindow?.removeGestureRecognizer(recognizer)
            installedWindow = nil
        }
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
            controller.rootView = AnyView(
                PanelDiagnosticsView(store: store) { [weak controller] in
                    controller?.dismiss(animated: true)
                })
            presenter.present(controller, animated: true)
        }
        @objc private func pressed() { if recognizer.state == .began { open() } }
        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool { true }
    }
}

struct PanelDiagnosticsView: View {
    struct ModuleStatus: Encodable, Equatable {
        let module: String
        let status: String
        let reason: String?
    }
    let store: LiveHomeDataSource?
    let close: () -> Void
    var embedded = false
    @State private var backend = "checking"
    @State private var checking = false
    @State private var lastCheckedAt: Date?
    @State private var latencyMs: Int?
    @State private var homeAssistant = "unknown"
    @State private var commands: [PanelCommandLog.Entry] = []
    @State private var events: [PanelEventLog.Entry] = []
    @State private var eventFilter = "All"
    @State private var shareFile: DiagnosticShareFile?
    @State private var shareError: String?
    @AppStorage("panel.diagnostics.deviceLabel") private var deviceLabel = ""
    @AppStorage("panel.diagnostics.lastUpload") private var lastUpload = ""
    @AppStorage("panel.diagnostics.lastUploadedEventID") private var lastUploadedEventID = ""
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
        PanelDiagnosticsSnapshot(
            source: source, backendURL: store?.diagnosticsBackendURL ?? "unavailable",
            build: build, gitSHA: gitSHA, backend: backend, latencyMs: latencyMs, homeAssistant: homeAssistant)
    }
    /// Read through the live providers on each render, including while Diagnostics is open.
    static func moduleStatuses(in store: LiveHomeDataSource?) -> [ModuleStatus] {
        guard let store else { return [] }
        return HomeModule.allCases.map { module in
            let status = store.status(for: module)
            let state: String
            switch status {
            case .loading: state = "loading"
            case .live: state = "live"
            case .unavailable: state = "unavailable"
            case .unconfigured: state = "unconfigured"
            }
            // HomeModuleStatus reasons are fixed provider copy / HTTP numbers,
            // never localizedDescription, response bodies, credentials or URLs.
            return ModuleStatus(module: module.rawValue, status: state, reason: status.reason)
        }
    }
    private var modules: [ModuleStatus] { Self.moduleStatuses(in: store) }
    private var visibleEvents: [PanelEventLog.Entry] {
        switch eventFilter {
        case "Errors": events.filter { $0.outcome != "ok" && $0.outcome != "slow" }
        case "Slow": events.filter { $0.outcome == "slow" || ($0.durationMs ?? 0) >= 1000 }
        default: events
        }
    }
    private var pendingEventCount: Int {
        guard let index = events.firstIndex(where: { $0.id.uuidString == lastUploadedEventID }) else {
            return events.count
        }
        return events.count - index - 1
    }
    var body: some View {
        Group {
            if embedded {
                contents
            } else {
                NavigationStack { contents }
            }
        }
        .preferredColorScheme(.dark)
        .accessibilityIdentifier("panel-diagnostics")
        .task { await check() }
        .onReceive(
            Foundation.NotificationCenter.default.publisher(for: PanelCommandLog.changedNotification).receive(
                on: RunLoop.main)
        ) { _ in commands = PanelCommandLog.shared.snapshot() }
        .onReceive(
            Foundation.NotificationCenter.default.publisher(for: PanelEventLog.changedNotification).receive(
                on: RunLoop.main)
        ) { _ in events = PanelEventLog.shared.snapshot() }
        .sheet(item: $shareFile, onDismiss: { shareFile = nil }) { file in
            DiagnosticActivitySheet(url: file.url)
        }
    }

    private var contents: some View {
        ScrollViewReader { scroll in
            List {
                Section("Panel") {
                    LabeledContent("Data source", value: source)
                    LabeledContent("Backend URL", value: store?.diagnosticsBackendURL ?? "unavailable")
                    LabeledContent("Build", value: build)
                    LabeledContent("Git SHA", value: gitSHA)
                }
                Section("This device") {
                    TextField("Device label", text: $deviceLabel)
                        .textInputAutocapitalization(.words)
                        .accessibilityIdentifier("diagnostics-device-label")
                    LabeledContent("Installation ID", value: PanelDeviceIdentity.id)
                        .textSelection(.enabled)
                    LabeledContent("Model", value: UIDevice.current.model)
                    LabeledContent("iOS", value: UIDevice.current.systemVersion)
                    HStack {
                        Text("Last upload")
                        Spacer()
                        if let date = ISO8601DateFormatter().date(from: lastUpload) {
                            HStack(spacing: 3) {
                                Text(date, style: .relative)
                                Text("ago")
                            }
                        } else {
                            Text("Not yet")
                        }
                    }
                }
                Section("Recent activity") {
                    LabeledContent(
                        "Local log storage", value: PanelEventLog.shared.storageAvailable ? "Available" : "Unavailable")
                    LabeledContent("Events waiting to upload", value: "\(pendingEventCount)")
                    LabeledContent(
                        "Failures", value: "\(events.filter { $0.outcome != "ok" && $0.outcome != "slow" }.count)")
                    LabeledContent("Slow operations", value: "\(events.filter { $0.outcome == "slow" }.count)")
                }
                Section {
                    Button("Share diagnostics") { share() }
                        .accessibilityIdentifier("diagnostics-share")
                    if let shareError { Text(shareError).foregroundStyle(.secondary) }
                }.id("diagnostics-actions")
                Section {
                    HStack {
                        Text("Backend")
                        Spacer()
                        Label(Self.connectionLabel(backend), systemImage: Self.stateSymbol(backend))
                            .foregroundStyle(Self.stateColor(backend))
                    }
                    if let latencyMs { LabeledContent("Ping latency", value: "\(latencyMs) ms") }
                    HStack {
                        Text("Home Assistant")
                        Spacer()
                        Label(Self.connectionLabel(homeAssistant), systemImage: Self.stateSymbol(homeAssistant))
                            .foregroundStyle(Self.stateColor(homeAssistant))
                    }
                } header: {
                    HStack {
                        Text("Connection")
                        Spacer()
                        if let lastCheckedAt {
                            HStack(spacing: 3) {
                                Text("Checked")
                                Text(lastCheckedAt, style: .relative)
                                Text("ago")
                            }.foregroundStyle(.secondary)
                        }
                        Button {
                            Task { await check() }
                        } label: {
                            Group {
                                if checking { ProgressView() } else { Image(systemName: "arrow.clockwise") }
                            }.frame(width: 44, height: 44)
                        }
                        .accessibilityLabel("Retry connection check")
                        .buttonStyle(.plain)
                        .foregroundStyle(.blue)
                        .disabled(checking)
                    }
                }
                Section("Feature status") {
                    ForEach(modules, id: \.module) { module in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(module.module.capitalized)
                                Spacer()
                                Label(Self.statusLabel(module.status), systemImage: Self.stateSymbol(module.status))
                                    .foregroundStyle(Self.stateColor(module.status))
                            }
                            if let reason = module.reason {
                                Text(reason).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("diagnostics-module-\(module.module)")
                    }
                }
                Section("Control actions (last 500)") {
                    ForEach(commands) { entry in
                        VStack(alignment: .leading, spacing: 4) {
                            Label(
                                entry.control,
                                systemImage: entry.error != nil
                                    ? "exclamationmark.circle.fill"
                                    : (entry.status == nil ? "arrow.up.circle.fill" : "checkmark.circle.fill")
                            )
                            .font(.headline)
                            .foregroundStyle(entry.error != nil ? .red : (entry.status == nil ? .blue : .green))
                            if !entry.payload.isEmpty {
                                Text(
                                    entry.payload.sorted(by: { $0.key < $1.key })
                                        .map { "\($0.key)=\($0.value)" }.joined(separator: ", "))
                            }
                            Text(
                                ([
                                    entry.error ?? (entry.status == nil ? "Action requested" : "Completed"),
                                    entry.status.map { "HTTP \($0)" }, "\(entry.latencyMs) ms",
                                ]
                                .compactMap { $0 }).joined(separator: " · "))
                        }.font(.caption).textSelection(.enabled)
                    }
                }
                Section("Client events (last 500)") {
                    Picker("Show", selection: $eventFilter) {
                        Text("All").tag("All")
                        Text("Errors").tag("Errors")
                        Text("Slow").tag("Slow")
                    }.pickerStyle(.segmented)
                    ForEach(visibleEvents.reversed()) { entry in
                        VStack(alignment: .leading, spacing: 4) {
                            Label("\(entry.category) · \(entry.action)", systemImage: Self.eventSymbol(entry.outcome))
                                .font(.headline)
                                .foregroundStyle(Self.eventColor(entry.outcome))
                            Text(entry.time, format: .dateTime.month().day().hour().minute().second())
                            Text(
                                ([
                                    entry.outcome, entry.status.map { "HTTP \($0)" },
                                    entry.durationMs.map { "\($0) ms" },
                                ].compactMap { $0 }).joined(separator: " · "))
                        }.font(.caption).textSelection(.enabled)
                    }
                }
            }
            .task {
                #if DEBUG
                    if ProcessInfo.processInfo.arguments.contains("-previewDiagnosticsActions") {
                        try? await Task.sleep(for: .milliseconds(400))
                        scroll.scrollTo("diagnostics-actions", anchor: .top)
                    }
                #endif
            }
            .navigationTitle("Diagnostics")
            .toolbar {
                if !embedded {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done", action: close).accessibilityIdentifier("diagnostics-done")
                    }
                }
            }
        }
    }
    private struct Ping: Decodable, Sendable {
        let status: String
        let timestamp: Double
    }
    private static func statusLabel(_ status: String) -> String {
        switch status {
        case "live": "Available"
        case "loading": "Checking"
        case "unavailable": "Unavailable"
        case "unconfigured": "Not set up"
        default: "Unknown"
        }
    }
    private static func connectionLabel(_ state: String) -> String {
        switch state {
        case "reachable", "connected": "Connected"
        case "unreachable", "unavailable": "Unavailable"
        case "checking": "Checking"
        case "unconfigured": "Not set up"
        default: "Unknown"
        }
    }
    private static func stateSymbol(_ state: String) -> String {
        switch state {
        case "live", "reachable", "connected": "checkmark.circle.fill"
        case "loading", "checking": "clock.fill"
        case "unavailable", "unreachable": "exclamationmark.circle.fill"
        default: "questionmark.circle.fill"
        }
    }
    private static func stateColor(_ state: String) -> Color {
        switch state {
        case "live", "reachable", "connected": .green
        case "loading", "checking": .orange
        case "unavailable", "unreachable": .red
        default: .secondary
        }
    }
    private static func eventSymbol(_ outcome: String) -> String {
        switch outcome {
        case "ok": "checkmark.circle.fill"
        case "slow": "clock.fill"
        case "cancelled": "minus.circle.fill"
        default: "exclamationmark.circle.fill"
        }
    }
    private static func eventColor(_ outcome: String) -> Color {
        switch outcome {
        case "ok": .green
        case "slow": .orange
        case "cancelled": .secondary
        default: .red
        }
    }
    private struct Health: Decodable, Sendable { let homeAssistant: String }
    @MainActor private func check() async {
        guard !checking else { return }
        checking = true
        defer { checking = false }
        PanelEventLog.shared.record(category: "diagnostics", action: "connection.check")
        commands = PanelCommandLog.shared.snapshot()
        events = PanelEventLog.shared.snapshot()
        guard let store else { return }
        defer { lastCheckedAt = Date() }
        backend = "checking"
        homeAssistant = "unknown"
        latencyMs = nil
        let started = Date()
        do {
            _ = try await store.diagnosticsClient.get("health", as: Ping.self)
            latencyMs = Int(Date().timeIntervalSince(started) * 1000)
            backend = "reachable"
        } catch {
            backend = "unreachable"
            PanelEventLog.shared.record(category: "diagnostics", action: "connection.check", outcome: "error")
            return
        }
        do {
            let health = try await store.diagnosticsClient.get("diagnostics/status", as: Health.self)
            homeAssistant = health.homeAssistant
        } catch { homeAssistant = "unknown" }
    }

    @MainActor private func share() {
        PanelEventLog.shared.record(category: "diagnostics", action: "share")
        events = PanelEventLog.shared.snapshot()
        let report = DiagnosticExport(
            device: .init(
                id: PanelDeviceIdentity.id, label: deviceLabel, model: UIDevice.current.model,
                systemVersion: UIDevice.current.systemVersion),
            snapshot: snapshot, modules: modules, commands: PanelCommandLog.shared.snapshot(), events: events)
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            encoder.dateEncodingStrategy = .iso8601
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(
                "panel-diagnostics-\(UUID().uuidString).json")
            try encoder.encode(report).write(to: url, options: .atomic)
            shareFile = DiagnosticShareFile(url: url)
            shareError = nil
        } catch { shareError = "Could not prepare diagnostics for sharing." }
    }
}

@MainActor enum PanelDeviceIdentity {
    static let id: String = {
        let key = "panel.diagnostics.installationID"
        if let existing = UserDefaults.standard.string(forKey: key), UUID(uuidString: existing) != nil {
            return existing
        }
        let value = UUID().uuidString
        UserDefaults.standard.set(value, forKey: key)
        return value
    }()
}

private struct DiagnosticExport: Encodable {
    struct Device: Encodable {
        let id: String
        let label: String
        let model: String
        let systemVersion: String
    }
    let device: Device
    let snapshot: PanelDiagnosticsSnapshot
    let modules: [PanelDiagnosticsView.ModuleStatus]
    let commands: [PanelCommandLog.Entry]
    let events: [PanelEventLog.Entry]
}

private struct DiagnosticShareFile: Identifiable {
    let id = UUID()
    let url: URL
}

private struct DiagnosticActivitySheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
