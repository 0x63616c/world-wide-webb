import SwiftUI

struct VolumeFader: View {
    let room: SoundRoom
    let store: any HomeDataSource
    var compact = false
    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .bottom) {
                Capsule().fill(.white.opacity(0.1))
                Capsule().fill(.white.opacity(room.muted ? 0.22 : 0.8))
                    .frame(height: max(5, proxy.size.height * Double(min(100, room.displayVolume)) / 100))
            }
            .overlay(
                Capsule().strokeBorder(.white.opacity(store.globalLock || store.groupLock ? 0.7 : 0.15), lineWidth: 1)
            )
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0).onChanged { value in
                    store.send(.volume(room.id, Int(((1 - value.location.y / proxy.size.height) * 100).rounded())))
                })
        }.frame(width: compact ? 23 : 64)
            .accessibilityElement().accessibilityLabel("\(room.name) volume").accessibilityValue(
                "\(room.displayVolume) percent"
            )
            .accessibilityAdjustableAction { direction in
                store.send(.volume(room.id, room.displayVolume + (direction == .increment ? 1 : -1)))
            }
    }
}
struct SoundFace: View {
    let store: any HomeDataSource
    var body: some View {
        VStack(spacing: 10) {
            HStack {
                Text("Sound System").font(.system(size: 21, weight: .semibold))
                Spacer()
                Button {
                    store.send(.globalLock)
                } label: {
                    Image(systemName: store.globalLock ? "lock.fill" : "lock.open").frame(width: 36, height: 32)
                }.buttonStyle(.plain).accessibilityLabel("Lock all rooms")
            }
            HStack(spacing: 15) {
                group(playing: true)
                group(playing: false)
            }
        }.padding(22)
    }
    private func group(playing: Bool) -> some View {
        VStack(spacing: 5) {
            HStack {
                Text(playing ? "Playing" : "Idle").font(.system(size: 12)).opacity(0.6)
                Spacer()
                if playing {
                    Button {
                        store.send(.groupLock)
                    } label: {
                        Image(systemName: store.groupLock ? "lock.fill" : "lock.open").font(.system(size: 11)).frame(
                            width: 30, height: 24)
                    }.buttonStyle(.plain).accessibilityLabel("Lock group")
                }
            }
            HStack(alignment: .bottom, spacing: 14) {
                ForEach(store.rooms.filter { $0.playing == playing }) { room in
                    VStack(spacing: 4) {
                        Text("\(room.displayVolume)%").font(.system(size: 12)).opacity(0.8)
                        VolumeFader(room: room, store: store, compact: true).frame(height: 46)
                        HStack(spacing: 2) {
                            Text(room.name).font(.system(size: 10, weight: .medium)).lineLimit(1).minimumScaleFactor(
                                0.7
                            )
                            .foregroundStyle(isCoordinator(room, rooms: store.rooms) ? Color.cyan : .white.opacity(0.7))
                        }
                        Button {
                            store.send(.mute(room.id))
                        } label: {
                            Image(systemName: room.muted ? "speaker.slash.fill" : "speaker.wave.2.fill").font(
                                .system(size: 11)
                            ).frame(width: 36, height: 20)
                        }.buttonStyle(.plain).accessibilityLabel("Mute \(room.name)")
                    }.frame(maxWidth: .infinity)
                }
            }
        }.padding(.horizontal, 10).padding(.vertical, 5).background(
            .white.opacity(playing ? 0.08 : 0.025), in: .rect(cornerRadius: 16))
    }
}
private func isCoordinator(_ room: SoundRoom, rooms: [SoundRoom]) -> Bool {
    room.name == room.coordinator && rooms.filter { $0.coordinator == room.name }.count > 1
}

#Preview("Sound System", traits: .fixedLayout(width: 1366, height: 1024)) { ControllerPreview(tile: .sound) }
