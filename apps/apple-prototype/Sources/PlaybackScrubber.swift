import SwiftUI

/// Fixture-backed seeking. Production needs position/duration fields and a seek mutation.
struct PlaybackScrubber: View {
    let store: any HomeDataSource
    let room: SoundRoom
    @State private var dragPosition: Double?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.motionPhase) private var phase
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            let position = dragPosition ?? room.position(at: store.now)
            VStack(spacing: 0) {
                GeometryReader { proxy in
                    ZStack(alignment: .leading) {
                        Capsule().fill(.white.opacity(0.22))
                        Capsule().fill(.white.opacity(0.9))
                            .frame(width: proxy.size.width * (room.durationSeconds > 0 ? position / room.durationSeconds : 0))
                    }.frame(height: dragPosition == nil ? 5 : 12)
                        .frame(height: 44).contentShape(Rectangle())
                        .gesture(DragGesture(minimumDistance: 0)
                            .onChanged { value in
                                dragPosition = min(room.durationSeconds, max(0, value.location.x / proxy.size.width * room.durationSeconds))
                            }.onEnded { _ in
                                if let dragPosition { store.send(.seek(room.id, dragPosition)) }
                                dragPosition = nil
                            })
                        .animation(reduceMotion ? nil : .smooth(duration: 0.2), value: dragPosition != nil)
                }.frame(height: 44)
                HStack {
                    Text(Self.time(position))
                    Spacer()
                    Text("−" + Self.time(room.durationSeconds - position))
                }.font(.system(size: 15, weight: .medium)).monospacedDigit().foregroundStyle(.secondary)
            }.accessibilityElement(children: .ignore)
                .accessibilityLabel("Track position")
                .accessibilityValue("\(Self.time(position)) of \(Self.time(room.durationSeconds))")
                .accessibilityAdjustableAction { direction in
                    store.send(.seek(room.id, position + (direction == .increment ? 10 : -10)))
                }.disabled(room.durationSeconds <= 0)
        }
    }
    static func time(_ seconds: Double) -> String {
        let value = Int(max(0, seconds))
        return String(format: "%d:%02d", value / 60, value % 60)
    }
}
