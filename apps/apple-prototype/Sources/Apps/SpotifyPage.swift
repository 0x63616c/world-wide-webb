import SwiftUI
import PanelKit

struct SpotifyPage: View {
    let provider: LiveSpotifyProvider
    @State private var link = ""
    private let green = Color(red: 0.12, green: 0.84, blue: 0.38)
    var body: some View {
        HStack(alignment: .top, spacing: 40) {
            VStack(alignment: .leading, spacing: 28) {
                HStack {
                    Image(systemName: "music.note").foregroundStyle(green)
                    Text("Spotify").fontWeight(.semibold)
                    Spacer()
                    Button("Refresh", systemImage: "arrow.clockwise") { Task { await provider.refresh(); provider.browse() } }
                        .labelStyle(.iconOnly).buttonStyle(.glass).controlSize(.large)
                }.font(.system(size: 44))
                sourcePicker
                library
                linkInput
            }.frame(maxWidth: .infinity, alignment: .topLeading)
            nowPlaying.frame(width: 360)
        }.padding(.horizontal, 48).padding(.top, 12).padding(.bottom, 40)
            .background(LinearGradient(colors: [green.opacity(0.1), .black, .black], startPoint: .topTrailing, endPoint: .bottomLeading))
            .task { await provider.run() }.onDisappear { provider.stopBrowsing() }
    }
    @ViewBuilder private var sourcePicker: some View {
        if let state = provider.state, !state.accounts.isEmpty {
            HStack {
                Text("Your library").font(.title2.weight(.semibold))
                Spacer()
                Menu {
                    ForEach(state.accounts) { account in
                        Button(account.name) { provider.selectSource(account.id) }
                    }
                    ForEach(state.rooms.filter(\.available)) { room in
                        Button("\(room.name) favourites") { provider.selectSource(room.id) }
                    }
                } label: {
                    Label(state.accounts.first { $0.id == provider.sourceID }?.name ?? "Sonos favourites", systemImage: "chevron.down")
                }.buttonStyle(.glass)
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text("Play something you love").font(.title2.weight(.semibold))
                Text("Connect Spotify in Home Assistant to browse your library. You can also play a Spotify link on Sonos.")
                    .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
    private var library: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                if !provider.path.isEmpty {
                    Button("Library back", systemImage: "chevron.left") { provider.back() }
                        .labelStyle(.iconOnly).buttonStyle(.glass)
                }
                Text(provider.path.last?.title ?? provider.library?.title ?? "Library").font(.title3.weight(.medium))
                Spacer()
                if provider.browsing { Text("Opening library…").foregroundStyle(.secondary).font(.callout) }
            }
            if let error = provider.libraryError {
                ContentUnavailableView("Library unavailable", systemImage: "music.note.list", description: Text(error))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let items = provider.library?.items, items.isEmpty {
                ContentUnavailableView("Nothing here yet", systemImage: "music.note.list", description: Text("Add music to this library in Spotify or Sonos."))
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(provider.library?.items ?? []) { item in
                            HStack(spacing: 18) {
                                Button { if item.expandable { provider.open(item) } else { provider.play(item.reference) } } label: {
                                    HStack(spacing: 18) {
                                        Image(systemName: item.expandable ? "square.stack.fill" : "music.note")
                                            .font(.title2).foregroundStyle(green).frame(width: 64, height: 64)
                                            .background(green.opacity(0.1), in: .rect(cornerRadius: 14))
                                        VStack(alignment: .leading, spacing: 6) {
                                            Text(item.title).font(.title3.weight(.medium)).lineLimit(2)
                                            Text(item.kind.capitalized).font(.callout).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        if item.expandable { Image(systemName: "chevron.right").foregroundStyle(.secondary) }
                                    }.contentShape(.rect)
                                }.buttonStyle(.plain).disabled(!item.expandable && (!item.playable || provider.pending || provider.room?.available != true))
                                if item.playable && item.expandable {
                                    Button("Play \(item.title)", systemImage: "play.fill") { provider.play(item.reference) }
                                        .labelStyle(.iconOnly).buttonStyle(.glass).controlSize(.large)
                                        .disabled(provider.pending || provider.room?.available != true)
                                }
                            }.padding(.vertical, 12)
                            Divider()
                        }
                    }
                }.disabled(provider.browsing)
            }
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
    private var linkInput: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Have a Spotify link?").font(.headline)
            HStack(spacing: 16) {
                TextField("Paste a song, album or playlist link", text: $link)
                    .textFieldStyle(.plain).padding(18).background(.white.opacity(0.08), in: .rect(cornerRadius: 14))
                    .accessibilityIdentifier("spotify-link")
                Button("Play", systemImage: "play.fill") {
                    provider.play(.init(id: link.trimmingCharacters(in: .whitespacesAndNewlines), type: "music"))
                }.buttonStyle(.glassProminent).tint(green).controlSize(.large)
                    .disabled(link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || provider.room?.available != true || provider.pending)
            }
        }
    }
    private var nowPlaying: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("LISTENING ON").font(.caption.weight(.semibold)).tracking(2).foregroundStyle(.secondary)
            Menu {
                ForEach(provider.state?.rooms ?? []) { room in
                    Button(room.name) { provider.selectRoom(room.id) }.disabled(!room.available)
                }
            } label: {
                HStack { Image(systemName: "hifispeaker.fill"); Text(provider.room?.name ?? "Choose a room"); Spacer(); Image(systemName: "chevron.down") }
                    .font(.title3.weight(.medium)).frame(maxWidth: .infinity)
            }.buttonStyle(.glass).controlSize(.extraLarge).accessibilityIdentifier("spotify-room")
            Spacer(minLength: 0)
            Image(systemName: "waveform").font(.system(size: 100, weight: .ultraLight))
                .foregroundStyle(green).frame(maxWidth: .infinity).frame(height: 220)
                .background(green.opacity(0.08), in: .rect(cornerRadius: 28)).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 10) {
                Text(provider.room?.title ?? "Ready when you are").font(.system(size: 30, weight: .semibold)).lineLimit(3)
                Text(provider.room?.artist ?? "Choose music from your library or a Spotify link.").foregroundStyle(.secondary)
            }
            HStack(spacing: 28) {
                transport("previous", symbol: "backward.end.fill", label: "Previous track")
                Button { provider.transport(provider.playing ? "pause" : "play") } label: {
                    Image(systemName: provider.playing ? "pause.fill" : "play.fill").font(.title).frame(width: 80, height: 80)
                }.buttonStyle(.glassProminent).tint(green).buttonBorderShape(.circle)
                    .accessibilityLabel(provider.playing ? "Pause music" : "Play music")
                    .disabled(provider.room?.available != true || provider.pending)
                transport("next", symbol: "forward.end.fill", label: "Next track")
            }.frame(maxWidth: .infinity)
            if let error = provider.error { Text(error).foregroundStyle(.orange).accessibilityIdentifier("spotify-error") }
            else if let notice = provider.notice { Text(notice).foregroundStyle(green) }
            else if provider.state?.rooms.isEmpty == true { Text("Add Sonos to Home Assistant to choose where music plays.").foregroundStyle(.secondary) }
            Spacer(minLength: 0)
            Text("Music plays on your Sonos speakers.").font(.callout).foregroundStyle(.secondary)
        }.padding(28).frame(maxHeight: .infinity).background(.white.opacity(0.035), in: .rect(cornerRadius: 28))
    }
    private func transport(_ command: String, symbol: String, label: String) -> some View {
        Button(label, systemImage: symbol) { provider.transport(command) }
            .labelStyle(.iconOnly).font(.title2).buttonStyle(.plain).frame(width: 44, height: 56)
            .disabled(provider.room?.available != true || provider.pending)
    }
}
