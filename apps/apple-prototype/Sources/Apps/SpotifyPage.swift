import SwiftUI
import PanelKit

struct SpotifyPage: View {
    let provider: LiveSpotifyProvider
    @Environment(\.personalNavigation) private var personal
    @State private var link = ""
    private var canPlay: Bool { provider.room?.available == true && !provider.pending }
    var body: some View {
        Form {
            Section {
                Picker("Speaker", selection: Binding(get: { provider.roomID ?? "" }, set: provider.selectRoom)) {
                    if provider.roomID == nil { Text("Choose a room").tag("") }
                    ForEach(provider.state?.rooms ?? []) { room in
                        Text(room.available ? room.name : "\(room.name) · Offline").tag(room.id).disabled(!room.available)
                    }
                }.accessibilityIdentifier("spotify-room")
                VStack(alignment: .leading, spacing: 8) {
                    Text(provider.room?.title ?? "Ready when you are").font(.title2.weight(.semibold))
                    Text(provider.room?.artist ?? "Choose something from your library or paste a Spotify link.")
                        .foregroundStyle(.secondary)
                }.padding(.vertical, 12)
                if !personal {
                    HStack(spacing: 32) { Spacer(); playbackControls; Spacer() }.padding(.vertical, 8)
                }
                if let error = provider.error { Text(error).foregroundStyle(.red).accessibilityIdentifier("spotify-error") }
                else if let notice = provider.notice { Text(notice).foregroundStyle(.secondary) }
            } header: { Text("Spotify · Now playing") }
              footer: { Text("Music plays on your Sonos speakers.") }
            Section {
                if provider.state?.accounts.isEmpty == true {
                    Text("Connect Spotify in Home Assistant to browse your Spotify library. Sonos favourites and Spotify links are available below.")
                        .foregroundStyle(.secondary)
                }
                Picker("Library", selection: Binding(get: { provider.sourceID ?? "" }, set: provider.selectSource)) {
                    if provider.sourceID == nil { Text("Choose a library").tag("") }
                    ForEach(provider.state?.accounts ?? []) { account in Text(account.name).tag(account.id) }
                    ForEach(provider.state?.rooms.filter(\.available) ?? []) { room in Text("\(room.name) favourites").tag(room.id) }
                }
                if !provider.path.isEmpty {
                    Button("Back to library", systemImage: "chevron.left", action: provider.back)
                }
                if let error = provider.libraryError {
                    Text(error).foregroundStyle(.secondary)
                    Button("Try again", systemImage: "arrow.clockwise", action: provider.browse)
                } else if provider.library?.items.isEmpty == true {
                    ContentUnavailableView("Nothing here yet", systemImage: "music.note.list", description: Text("Add music in Spotify or Sonos."))
                } else {
                    ForEach(provider.library?.items ?? []) { item in
                        HStack {
                            Button { if item.expandable { provider.open(item) } else { provider.play(item.reference) } } label: {
                                HStack {
                                    Label(item.title, systemImage: item.expandable ? "square.stack" : "music.note")
                                    Spacer()
                                    if item.expandable { Image(systemName: "chevron.right").foregroundStyle(.secondary) }
                                }.frame(minHeight: 44).contentShape(.rect)
                            }.buttonStyle(.plain).disabled(provider.browsing || (!item.expandable && (!item.playable || !canPlay)))
                            if item.expandable && item.playable {
                                Button("Play \(item.title)", systemImage: "play.fill") { provider.play(item.reference) }
                                    .labelStyle(.iconOnly).buttonStyle(.borderless).frame(minWidth: 44, minHeight: 44).disabled(!canPlay)
                            }
                        }
                    }
                }
            } header: { Text(provider.path.last?.title ?? provider.library?.title ?? "Library") }
            Section {
                TextField("Song, album or playlist link", text: $link)
                    .accessibilityIdentifier("spotify-link")
                    #if os(iOS)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    #endif
                Button("Play on \(provider.room?.name ?? "Sonos")", systemImage: "play.fill") {
                    provider.play(.init(id: link.trimmingCharacters(in: .whitespacesAndNewlines), type: "music"))
                }.disabled(link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !canPlay)
            } header: { Text("Spotify link") }
        }.formStyle(.grouped).navigationTitle("Spotify")
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    if personal { playbackControls }
                    Button("Refresh music", systemImage: "arrow.clockwise") { Task { await provider.refresh(); provider.browse() } }
                }
            }
            .task { await provider.run() }.onDisappear { provider.stopBrowsing() }
    }
    @ViewBuilder private var playbackControls: some View {
        transport("previous", symbol: "backward.end.fill", label: "Previous track")
        Button(provider.playing ? "Pause music" : "Play music", systemImage: provider.playing ? "pause.fill" : "play.fill") {
            provider.transport(provider.playing ? "pause" : "play")
        }.disabled(!canPlay).accessibilityIdentifier("spotify-play-pause")
        transport("next", symbol: "forward.end.fill", label: "Next track")
    }
    private func transport(_ command: String, symbol: String, label: String) -> some View {
        Button(label, systemImage: symbol) { provider.transport(command) }
            .disabled(!canPlay)
    }
}
