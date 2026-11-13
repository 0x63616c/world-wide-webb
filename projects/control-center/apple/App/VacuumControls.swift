import PanelKit
import SwiftUI

/// A small section in the existing controls page; no background worker or
/// optimistic physical state. Refresh after a command, never replay on error.
struct VacuumControls: View {
    let api: VacuumAPI
    @State private var snapshot: VacuumSnapshot?
    @State private var pending = false
    @State private var message: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Label("Vacuum", systemImage: "robot.vacuum")
                    .font(.title2.weight(.semibold))
                Spacer()
                Button("Refresh", systemImage: "arrow.clockwise") {
                    Task { await refresh() }
                }.disabled(pending)
            }
            if let snapshot {
                HStack {
                    Text(snapshot.status.capitalized)
                    if let battery = snapshot.battery {
                        Text("\(Int(battery))% battery")
                    }
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 110))], spacing: 12) {
                    command("Start", action: .start)
                    command("Pause", action: .pause)
                    command("Stop", action: .stop)
                    command("Dock", action: .dock)
                    ForEach(snapshot.rooms) { room in
                        command("Clean \(room.name)", action: .room, room: room.id)
                    }
                }.disabled(pending)
            } else {
                Text("Vacuum unavailable. Complete Dreame setup in Home Assistant.")
                    .foregroundStyle(.secondary)
            }
            if let message { Text(message).foregroundStyle(.secondary) }
        }.task { await refresh() }
    }

    private func command(_ title: String, action: VacuumAPI.Action, room: String? = nil) -> some View {
        Button(title) {
            guard !pending else { return }
            pending = true
            message = nil
            Task { @MainActor in
                defer { pending = false }
                do {
                    try await api.command(action, room: room)
                    snapshot = try await api.list()
                } catch {
                    message = "Could not confirm vacuum state. Refresh before trying again."
                }
            }
        }.buttonStyle(.bordered).frame(minHeight: 44)
    }

    @MainActor private func refresh() async {
        guard !pending else { return }
        pending = true
        defer { pending = false }
        do {
            snapshot = try await api.list()
            message = nil
        } catch {
            snapshot = nil
            message = "Vacuum unavailable. Check Home Assistant and refresh."
        }
    }
}
