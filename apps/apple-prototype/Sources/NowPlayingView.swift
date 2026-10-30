import SwiftUI

struct NowPlayingView: View {
    let store: any HomeDataSource
    let close: () -> Void
    var isFace = false
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var compact: Bool { sizeClass == .compact }
    @State private var roomID = "Living Room"
    @State private var choosingRoom = false
    private var room: SoundRoom? { store.rooms.first { $0.id == roomID } ?? store.rooms.first }
    var body: some View {
        GeometryReader { proxy in
            if let room {
                ZStack {
                    if !isFace { MusicBackdrop(tint: room.artworkTint) }
                    VStack(spacing: 0) {
                        HStack {
                            CircleButton(symbol: isFace ? "house" : "xmark", label: isFace ? "Home" : "Close music", size: compact ? 44 : 64, action: close)
                            Spacer()
                            VStack(spacing: 5) {
                                Text(room.name).font(.system(size: compact ? 20 : 25, weight: .semibold))
                                HStack(spacing: 10) { Text(room.sourceLabel ?? room.sourceKind.rawValue.capitalized).font(.system(size: 18)).foregroundStyle(.secondary); PlayingEqualizer(playing: room.playing).scaleEffect(0.65).frame(width: 24, height: 20) }
                            }
                            Spacer()
                            CircleButton(symbol: "hifispeaker.2.fill", label: "Rooms and groups", size: compact ? 44 : 64) { choosingRoom = true }
                        }.padding(.horizontal, compact ? 20 : 40).padding(.top, compact ? 16 : 32)
                        Spacer(minLength: 18)
                        artwork(room).frame(width: compact ? min(proxy.size.width - 64, proxy.size.height * 0.39) : 440, height: compact ? min(proxy.size.width - 64, proxy.size.height * 0.39) : 440)
                            .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                            .shadow(color: .black.opacity(0.28), radius: 36, y: 20)
                        VStack(alignment: .leading, spacing: 7) {
                            Text(room.trackTitle ?? room.sourceLabel ?? "Nothing playing")
                                .font(.system(size: compact ? 25 : 32, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.7)
                            Text(room.trackArtist ?? " ").font(.system(size: compact ? 19 : 23)).foregroundStyle(.secondary)
                        }.frame(width: compact ? proxy.size.width - 48 : 440, alignment: .leading).padding(.top, compact ? 16 : 20)
                        PlaybackScrubber(store: store, room: room)
                            .frame(width: compact ? proxy.size.width - 48 : 440).padding(.top, compact ? 14 : 18)
                        HStack(spacing: compact ? 30 : 76) {
                            transport("backward.end.fill", label: "Previous track", command: .previous, room: room)
                            transport(room.playing ? "pause.fill" : "play.fill", label: room.playing ? "Pause" : "Play", command: room.playing ? .pause : .play, room: room, large: true)
                            transport("forward.end.fill", label: "Next track", command: .next, room: room)
                        }.padding(.top, 10)
                        VStack(spacing: 10) {
                            HStack(spacing: 22) {
                                Button { store.send(.mute(room.id)) } label: {
                                    Image(systemName: room.muted ? "speaker.slash.fill" : "speaker.fill").font(.system(size: 27)).frame(width: 48, height: 48)
                                }.buttonStyle(.plain).accessibilityLabel(room.muted ? "Unmute \(room.name)" : "Mute \(room.name)")
                                Slider(value: Binding(get: { Double(room.rawVolume) }, set: { store.send(.rawVolume(room.id, Int($0))) }), in: 0...100, step: 1)
                                    .tint(.white).accessibilityLabel("\(room.name) volume")
                                Image(systemName: "speaker.wave.3.fill").font(.system(size: 27)).frame(width: 48, height: 48)
                            }
                            HStack {
                                Text(room.muted ? "Muted" : "Volume")
                                Spacer()
                                Text("\(room.rawVolume)%").monospacedDigit()
                            }.font(.system(size: 20, weight: .medium)).foregroundStyle(.primary)
                        }.frame(width: compact ? proxy.size.width - 48 : 440).padding(.top, 8)
                        Spacer(minLength: compact ? 16 : 24)
                    }.padding(.bottom, isFace && !compact ? HomeFaceLayout.panelPagerBand : 0)
                }.frame(width: proxy.size.width, height: proxy.size.height)
            } else {
                Color.black.overlay(Text("No rooms available").font(.largeTitle))
            }
        }.foregroundStyle(.white).ignoresSafeArea()
            .sheet(isPresented: $choosingRoom) {
                VStack(alignment: .leading, spacing: 22) {
                    HStack {
                        Text("Rooms & groups").font(.system(size: 32, weight: .semibold))
                        Spacer()
                        CircleButton(symbol: "xmark", label: "Close rooms", size: 48) { choosingRoom = false }
                    }
                    ForEach(store.rooms) { candidate in
                        HStack(spacing: 20) {
                            Button { roomID = candidate.id } label: {
                                HStack(spacing: 18) {
                                    Image(systemName: candidate.id == room?.id ? "checkmark.circle.fill" : "hifispeaker.fill").font(.system(size: 28))
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text(candidate.name).font(.system(size: 25, weight: .semibold))
                                        Text(candidate.coordinator == candidate.name ? "\(candidate.playing ? "Playing" : "Paused") · \(candidate.sourceLabel ?? "Sonos")" : "Grouped with \(candidate.coordinator)")
                                            .font(.system(size: 18)).opacity(0.65)
                                    }
                                }.frame(maxWidth: .infinity, alignment: .leading)
                            }.buttonStyle(.plain).accessibilityLabel("Select \(candidate.name)")
                            if let room, candidate.coordinator != room.coordinator {
                                Button("Join") { store.send(.join(candidate.id, room.coordinator)) }.buttonStyle(.glass)
                                    .accessibilityLabel("Join \(candidate.name) to \(room.coordinator)")
                            }
                        }.padding(.vertical, 12)
                    }
                    if let room {
                        Button("Group all with \(room.name)") { store.send(.joinAll(room.name)) }
                            .font(.system(size: 22, weight: .semibold)).buttonStyle(.glass).padding(.top, 8)
                    }
                }.padding(36).frame(width: 620).presentationSizing(.fitted)
                    .presentationBackground(Color(hex: "#4e283e")).foregroundStyle(.white)
            }
    }
    @ViewBuilder private func artwork(_ room: SoundRoom) -> some View {
        if let uri = room.albumArtUri, let url = URL(string: uri) {
            AsyncImage(url: url) { phase in
                if let image = phase.image { image.resizable().scaledToFill() }
                else { FixtureArtwork(tint: room.artworkTint) }
            }
        } else { FixtureArtwork(tint: room.artworkTint) }
    }
    private func transport(_ symbol: String, label: String, command: SonosTransport, room: SoundRoom, large: Bool = false) -> some View {
        Button { store.send(.transport(room.id, command)) } label: {
            Image(systemName: symbol).font(.system(size: large ? (compact ? 44 : 53) : (compact ? 30 : 42), weight: .semibold))
                .frame(width: compact ? 64 : 72, height: compact ? 64 : 72)
        }.buttonStyle(.plain).accessibilityLabel(label)
    }
}

/// Original procedural fixture artwork, deliberately unrelated to any real album cover.
struct FixtureArtwork: View {
    let tint: String
    var body: some View {
        GeometryReader { proxy in
            let s = proxy.size.width
            ZStack {
                LinearGradient(colors: [Color(hex: "#2c1734"), Color(hex: tint), Color(hex: "#e87891")], startPoint: .topLeading, endPoint: .bottomTrailing)
                Circle().fill(LinearGradient(colors: [Color(hex: "#ffc9b1"), Color(hex: "#e4508a")], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: s * 0.67, height: s * 0.67).position(x: s * 0.62, y: s * 0.39)
                ForEach(0..<8) { i in
                    Ellipse().strokeBorder(Color(hex: "#481c4b").opacity(0.65), lineWidth: s * 0.045)
                        .frame(width: s * 1.20, height: s * 0.72)
                        .rotationEffect(.degrees(-28))
                        .position(x: s * 0.36, y: s * (0.57 + Double(i) * 0.07))
                }
                Text("EVENING\nHOURS").font(.system(size: s * 0.055, weight: .medium)).tracking(s * 0.013)
                    .foregroundStyle(.white.opacity(0.8)).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading).padding(s * 0.07)
            }.clipped()
        }.accessibilityLabel("Procedural fixture artwork")
    }
}

struct MusicBackdrop: View {
    let tint: String
    var body: some View {
        LinearGradient(colors: [Color(hex: tint), Color(hex: tint).mix(with: .black, by: 0.62)], startPoint: .top, endPoint: .bottom)
            .overlay { RadialGradient(colors: [.white.opacity(0.10), .clear], center: UnitPoint(x: 0.5, y: 0.28), startRadius: 0, endRadius: 700) }
            .ignoresSafeArea()
    }
}
