import Foundation

/// Panel excludes Sources/App.swift, which owns the prototype's readiness hook.
/// Keep that hook available to shared views and use it for explicit fixture captures.
@MainActor func signalSnapshotReady() async {
    #if DEBUG
    guard ProcessInfo.processInfo.arguments.contains("-hybridFixtures") else { return }
    do { try await Task.sleep(for: .seconds(2)) } catch { return }
    let marker = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("hybrid-capture-ready")
    try? Data("ready".utf8).write(to: marker, options: .atomic)
    #endif
}
