import SwiftUI

/// Uses the existing Sonos commands and baseline-calibrated room volume.
struct SonosRoomsPage: View {
    let store: any HomeDataSource
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var compact: Bool { sizeClass == .compact }
    var body: some View {
        ScrollView {
            GlassEffectContainer(spacing: 16) {
                VStack(alignment: .leading, spacing: 28) {
                    HStack {
                        Text("Listen together").font(.system(size: compact ? 30 : 44, weight: .bold))
                        Spacer()
                        Menu {
                            Button("Join all to Desk") { store.send(.joinAll("Desk")) }
                            Button("Join all to Living Room") { store.send(.joinAll("Living Room")) }
                            Button(store.globalLock ? "Unlock global volume" : "Lock global volume") { store.send(.globalLock) }
                            Button(store.groupLock ? "Unlock group volume" : "Lock group volume") { store.send(.groupLock) }
                            Button("Calibrate") { store.send(.calibrate) }
                            Button("Clear calibration") { store.send(.clearCalibration) }
                        } label: { Image(systemName: "ellipsis").frame(width: 52, height: 52) }.buttonStyle(.glass)
                    }
                    Text("Volume is relative to each room’s calibrated baseline.").font(.system(size: compact ? 16 : 20)).foregroundStyle(.secondary)
                    ForEach(store.rooms) { room in
                        roomRow(room)
                    }
                }.padding(compact ? 24 : 56)
            }
        }
    }
    private func roomRow(_ room: SoundRoom) -> some View {
        let layout = compact ? AnyLayout(VStackLayout(alignment: .leading, spacing: 16)) : AnyLayout(HStackLayout(spacing: 32))
        return layout {
            HStack(spacing: 20) {
                Image(systemName: "hifispeaker.fill").font(.system(size: 30))
                VStack(alignment: .leading, spacing: 6) {
                    Text(room.name).font(.system(size: compact ? 21 : 26, weight: .semibold))
                    Text(room.playing ? room.trackTitle ?? "Playing" : "Paused").font(.system(size: compact ? 15 : 18)).foregroundStyle(.secondary)
                }
            }.frame(width: compact ? nil : 330, alignment: .leading)
            HStack(spacing: 20) {
                Button { store.send(.mute(room.id)) } label: {
                    Image(systemName: room.muted ? "speaker.slash.fill" : "speaker.wave.2.fill").frame(width: 44, height: 44)
                }.buttonStyle(.plain).accessibilityLabel(room.muted ? "Unmute \(room.name)" : "Mute \(room.name)")
                Slider(value: Binding(get: { Double(room.displayVolume) }, set: { store.send(.volume(room.id, Int($0))) }), in: 0...100)
                    .accessibilityLabel("\(room.name) volume")
                Text("\(room.displayVolume)%").font(.system(size: 20, weight: .medium)).monospacedDigit().frame(width: 56)
            }.frame(maxWidth: .infinity)
            Menu {
                ForEach(store.rooms.filter { $0.id != room.id }) { target in
                    Button("Join \(target.name)") { store.send(.join(room.id, target.id)) }
                }
                Button("Make standalone") { store.send(.leave(room.id)) }
            } label: {
                Label(room.coordinator == room.id ? "Group" : room.coordinatorLabel, systemImage: "speaker.wave.2.bubble")
                    .font(.system(size: 16)).frame(width: compact ? nil : 150, alignment: .leading)
            }.menuStyle(.borderlessButton)
        }.padding(24).glassEffect(.regular, in: .rect(cornerRadius: 32))
    }
}
