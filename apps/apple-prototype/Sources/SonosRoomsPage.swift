import SwiftUI

struct SonosRoomsPage: View {
    let store: any HomeDataSource
    var playEverywhere: (() -> Void)? = nil
    var busy = false
    private var speakers: [SoundRoom] { store.rooms.filter { $0.name != "Living Room" } }
    var body: some View {
        VStack(alignment: .leading, spacing: 32) {
            HStack {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Line-in").font(.system(size: 38, weight: .bold))
                    Text("Desk").font(.system(size: 21)).foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    if let playEverywhere { playEverywhere() }
                    else if let desk = store.rooms.first(where: { $0.name == "Desk" }) {
                        for room in speakers where room.id != desk.id { store.send(.join(room.id, desk.id)) }
                    }
                } label: {
                    Label("Play everywhere", systemImage: "hifispeaker.2")
                        .font(.system(size: 20, weight: .semibold)).padding(14)
                }.buttonStyle(.glass).disabled(busy)
            }
            GlassEffectContainer(spacing: 24) {
                HStack(alignment: .top, spacing: 48) {
                    VStack(spacing: 24) {
                        ForEach(speakers) { room in volume(room) }
                    }.frame(maxWidth: .infinity)
                    if let tv = store.rooms.first(where: { $0.name == "Living Room" }) {
                        VStack(alignment: .leading, spacing: 20) {
                            Image(systemName: "tv").font(.system(size: 52, weight: .light)).padding(.bottom, 12)
                            volume(tv)
                        }.frame(width: 300).padding(28)

                    }
                }
            }
        }.padding(48).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
    private func volume(_ room: SoundRoom) -> some View {
        VStack(spacing: 10) {
            HStack {
                Text(room.name).font(.system(size: 21, weight: .semibold))
                Spacer()
                Text("\(room.rawVolume)%").font(.system(size: 18)).monospacedDigit().foregroundStyle(.secondary)
            }
            FilledVolumeControl(value: room.rawVolume, label: "\(room.name) volume") { store.send(.rawVolume(room.id, $0)) }
                .frame(height: 70)
        }
    }
}

/// SwiftUI has no public Home-app filled slider style. This control keeps the
/// same adjustable accessibility semantics and commits once per drag.
struct FilledVolumeControl: View {
    let value: Int
    let label: String
    let commit: (Int) -> Void
    @State private var dragging: Int?
    private var displayed: Int { dragging ?? value }
    var body: some View {
        GeometryReader { proxy in
            let fraction = Double(displayed) / 100
            ZStack(alignment: .leading) {
                Color.clear
                Rectangle().fill(.white.opacity(0.38)).frame(width: proxy.size.width * fraction)
                Image(systemName: "speaker.wave.2.fill").font(.system(size: 22))
                    .foregroundStyle(.white).padding(.leading, 24)
                Capsule().fill(.white.opacity(0.9)).frame(width: 4, height: 22)
                    .offset(x: max(12, min(proxy.size.width - 16, proxy.size.width * fraction - 10)))
            }.clipShape(.rect(cornerRadius: 24))
                .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 24))
                .contentShape(.rect)
                .gesture(DragGesture(minimumDistance: 0)
                    .onChanged { drag in dragging = Int((max(0, min(1, drag.location.x / proxy.size.width)) * 100).rounded()) }
                    .onEnded { _ in if let dragging { commit(dragging) }; dragging = nil })
        }.accessibilityElement(children: .ignore).accessibilityLabel(label)
            .accessibilityValue("\(displayed) percent")
            .accessibilityAdjustableAction { direction in
                commit(min(100, max(0, value + (direction == .increment ? 5 : -5))))
            }
    }
}
