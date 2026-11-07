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
            .overlay(Capsule().strokeBorder(.white.opacity(store.globalLock || store.groupLock ? 0.7 : 0.15), lineWidth: 1))
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { value in
                store.send(.volume(room.id, Int(((1 - value.location.y / proxy.size.height) * 100).rounded())))
            })
        }.frame(width: compact ? 23 : 64)
            .accessibilityElement().accessibilityLabel("\(room.name) volume").accessibilityValue("\(room.displayVolume) percent")
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
                Button { store.send(.globalLock) } label: { Image(systemName: store.globalLock ? "lock.fill" : "lock.open").frame(width: 36, height: 32) }.buttonStyle(.plain).accessibilityLabel("Lock all rooms")
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
                    Button { store.send(.groupLock) } label: { Image(systemName: store.groupLock ? "lock.fill" : "lock.open").font(.system(size: 11)).frame(width: 30, height: 24) }.buttonStyle(.plain).accessibilityLabel("Lock group")
                }
            }
            HStack(alignment: .bottom, spacing: 14) {
                ForEach(store.rooms.filter { $0.playing == playing }) { room in
                    VStack(spacing: 4) {
                        Text("\(room.displayVolume)%").font(.system(size: 12)).opacity(0.8)
                        VolumeFader(room: room, store: store, compact: true).frame(height: 46)
                        HStack(spacing: 2) {
                            Text(room.name).font(.system(size: 10, weight: .medium)).lineLimit(1).minimumScaleFactor(0.7)
                                .foregroundStyle(isCoordinator(room, rooms: store.rooms) ? Color.cyan : .white.opacity(0.7))
                        }
                        Button { store.send(.mute(room.id)) } label: {
                            Image(systemName: room.muted ? "speaker.slash.fill" : "speaker.wave.2.fill").font(.system(size: 11)).frame(width: 36, height: 20)
                        }.buttonStyle(.plain).accessibilityLabel("Mute \(room.name)")
                    }.frame(maxWidth: .infinity)
                }
            }
        }.padding(.horizontal, 10).padding(.vertical, 5).background(.white.opacity(playing ? 0.08 : 0.025), in: .rect(cornerRadius: 16))
    }
}
private func isCoordinator(_ room: SoundRoom, rooms: [SoundRoom]) -> Bool {
    room.name == room.coordinator && rooms.filter { $0.coordinator == room.name }.count > 1
}
struct SoundController: View {
    let store: any HomeDataSource
    var body: some View {
        VStack(spacing: 30) {
            HStack(spacing: 14) {
                Choice(title: "Join all to Desk") { store.send(.joinAll("Desk")) }
                Choice(title: "Join all to TV") { store.send(.joinAll("Living Room")) }
                Spacer()
                Choice(title: "Calibrate") { store.send(.calibrate) }
                Choice(title: "Clear") { store.send(.clearCalibration) }
                Choice(title: store.globalLock ? "Locked" : "Lock", selected: store.globalLock) { store.send(.globalLock) }
            }
            HStack(alignment: .top, spacing: 22) {
                group(playing: true)
                group(playing: false)
            }
            HStack {
                Text(store.rooms.contains { $0.baseline != nil } ? "Calibrated · volume as a percentage of each room’s baseline" : "Showing raw volume").font(.system(size: 18)).opacity(0.6)
                Spacer()
                if store.pending.contains("sound") { ProgressView() }
            }
        }.padding(.horizontal, 46).padding(.top, 34).padding(.bottom, 34)
    }
    private func group(playing: Bool) -> some View {
        let rooms = store.rooms.filter { $0.playing == playing }
        return Group {
            if !rooms.isEmpty {
                VStack(spacing: 25) {
                    HStack {
                        Text(playing ? "Playing" : "Idle").font(.system(size: 22, weight: .semibold)).opacity(0.7)
                        Spacer()
                        if playing {
                            Button { store.send(.groupLock) } label: { Label("Group", systemImage: store.groupLock ? "lock.fill" : "lock.open") }.buttonStyle(.glass).disabled(store.globalLock)
                        }
                    }
                    HStack(spacing: 20) {
                        ForEach(rooms) { room in
                            VStack(spacing: 15) {
                                Text("\(room.displayVolume)%").font(.system(size: 38, weight: .light)).monospacedDigit()
                                VolumeFader(room: room, store: store).frame(minHeight: 150, maxHeight: .infinity)
                                HStack(spacing: 12) {
                                    CircleButton(symbol: "minus", label: "Lower \(room.name) volume", size: 35) { store.send(.volume(room.id, room.displayVolume - 1)) }
                                    CircleButton(symbol: "plus", label: "Raise \(room.name) volume", size: 35) { store.send(.volume(room.id, room.displayVolume + 1)) }
                                }
                                Text(room.name).font(.system(size: 20, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.7)
                                    .foregroundStyle(isCoordinator(room, rooms: store.rooms) ? Color.cyan : .white)
                                Text(room.coordinator == room.name ? "Standalone" : "Following \(room.coordinator)").font(.system(size: 12)).opacity(0.5)
                                Button { store.send(.mute(room.id)) } label: {
                                    Label(room.muted ? "Unmute" : "Mute", systemImage: room.muted ? "speaker.slash.fill" : "speaker.wave.2.fill").font(.system(size: 15))
                                }.buttonStyle(.glass)
                                Menu("Move") {
                                    ForEach(store.rooms.filter { $0.name != room.name }) { target in
                                        Button("Join \(target.name)") { store.send(.join(room.id, target.name)) }
                                    }
                                    Button("Make standalone") { store.send(.leave(room.id)) }
                                }.font(.system(size: 15)).menuStyle(.borderlessButton)
                            }.frame(maxWidth: .infinity).opacity(room.muted ? 0.55 : 1)
                        }
                    }
                }.padding(24).frame(maxWidth: .infinity).glassEffect(.regular, in: .rect(cornerRadius: 32))
            }
        }
    }
}
#Preview("Sound System", traits: .fixedLayout(width: 1366, height: 1024)) { ControllerPreview(tile: .sound) }
