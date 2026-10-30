import SwiftUI

/// Compose the existing clock dial with the server-provided next alarm. Other
/// prototype complications would need unrelated live providers to be meaningful.
struct HybridClockFace: View {
    let store: LiveHomeDataSource
    let open: () -> Void
    var body: some View {
        VStack(spacing: 16) {
            TileFace(tile: .clock, store: store, open: open)
            TimelineView(.periodic(from: .now, by: 1)) { _ in
                let next = store.upcomingAlarm(at: store.now)
                Button(action: open) {
                    Label(next.map { "\($0.alarm.label) · \($0.alarm.time)" } ?? "No upcoming alarms", systemImage: "alarm")
                        .font(.title2)
                }.buttonStyle(.glass).padding(.bottom, 24)
            }
        }
    }
}
