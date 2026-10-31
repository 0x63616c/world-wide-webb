import SwiftUI

// Page-2 faces share the grid's ink inset and material; their providers and
// full-screen destinations are the same ones used by the legacy Home.
struct GridCameras: View {
    let store: any HomeDataSource
    var body: some View {
        GridCaptionImage(asset: store.cameras.feeds.first?.asset) {
            Corners {
                Cap("Cameras", 22, .semibold)
            } tr: {
                Cap("\(store.cameras.feeds.count) feeds", 17).opacity(0.75)
            } bl: {
                VStack(alignment: .leading, spacing: 12) {
                    Cap(store.cameras.feeds.first?.name ?? "No cameras", 26, .semibold, lines: 2)
                    Cap("Demo feeds", 17).opacity(0.75)
                }
            } br: { EmptyView() }
        }
    }
}

struct GridPhotos: View {
    let store: any HomeDataSource
    @Environment(\.motionPhase) private var phase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var index = 1
    private var photo: PhotoItem? {
        let photos = store.photos.photos
        return photos.isEmpty ? nil : photos[index % photos.count]
    }
    var body: some View {
        GridCaptionImage(asset: photo?.asset) {
            Corners {
                Cap("Photos", 22, .semibold)
            } tr: {
                Cap("\(store.photos.photos.count) photos", 17).opacity(0.75)
            } bl: {
                VStack(alignment: .leading, spacing: 12) {
                    Cap(photo?.title ?? "No photos", 26, .semibold, lines: 2)
                    if let photo { Cap(photo.credit, 17).opacity(0.75) }
                }
            } br: { EmptyView() }
        }.task(id: reduceMotion) {
            guard !reduceMotion, phase == nil else { return }
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(12)) } catch { return }
                guard !store.photos.photos.isEmpty else { continue }
                withAnimation(.easeInOut(duration: 0.4)) { index = (index + 1) % store.photos.photos.count }
            }
        }
    }
}

private struct GridCaptionImage<Caption: View>: View {
    let asset: String?
    @ViewBuilder var caption: Caption
    var body: some View {
        GeometryReader { proxy in
            ZStack {
                if let asset {
                    Image(asset).resizable().scaledToFill()
                        .frame(width: proxy.size.width, height: proxy.size.height).clipped()
                        .accessibilityHidden(true)
                }
                LinearGradient(colors: [.black.opacity(0.45), .clear, .black.opacity(0.75)], startPoint: .top, endPoint: .bottom)
                caption
            }.frame(width: proxy.size.width, height: proxy.size.height)
                .clipShape(.rect(cornerRadius: HomeGrid.radius))
        }
    }
}

struct GridSonosRooms: View {
    let v: String
    let store: any HomeDataSource
    var body: some View {
        Corners {
            Cap("Sonos rooms", 22, .semibold)
        } tr: {
            Image(systemName: "hifispeaker.fill").font(.system(size: 22))
        } bl: {
            if v == "B" {
                VStack(alignment: .leading, spacing: 20) {
                    ForEach(store.rooms.prefix(4)) { room in
                        VStack(alignment: .leading, spacing: 8) {
                            Cap(room.name, 20, .semibold, lines: 2)
                            Cap("\(room.playing ? "Playing" : "Paused") · \(room.displayVolume)%", 17).opacity(0.65)
                        }
                    }
                    Cap("All \(store.rooms.count) rooms ›", 17).opacity(0.65)
                }
            } else {
                VStack(alignment: .leading, spacing: 14) {
                    Cap("\(store.rooms.count { $0.playing }) playing", 32, .medium)
                    Cap("All \(store.rooms.count) rooms ›", 17).opacity(0.65)
                }
            }
        } br: { EmptyView() }
    }
}

struct GridWifi: View {
    let v: String
    let store: any HomeDataSource
    var body: some View {
        Corners {
            Cap("Wi-Fi", 22, .semibold)
        } tr: {
            Image(systemName: "wifi").font(.system(size: 22))
        } bl: {
            VStack(alignment: .leading, spacing: 16) {
                if v == "B", let qr = WifiQRCode.render(store.wifi) {
                    Image(decorative: qr, scale: 1).interpolation(.none).resizable()
                        .frame(width: 180, height: 180).padding(12).background(.white, in: .rect(cornerRadius: 16))
                        .accessibilityLabel("Guest Wi-Fi join QR code")
                }
                Cap(store.wifi.ssid ?? "Not configured", 26, .medium, lines: 2)
                Cap(store.wifi.ssid == nil ? "Guest network unavailable" : "Tap to join ›", 17).opacity(0.65)
            }
        } br: { EmptyView() }
    }
}

struct GridDogWalk: View {
    let v: String
    let store: any HomeDataSource
    let open: () -> Void
    var body: some View {
        TimelineView(.periodic(from: store.now, by: 1)) { _ in
            Corners {
                Button(action: open) { Cap("Walk Zero", 22, .semibold) }
                    .buttonStyle(.plain).accessibilityLabel("Walk Zero history")
            } tr: {
                Image(systemName: "pawprint.fill").font(.system(size: 22))
            } bl: {
                VStack(alignment: .leading, spacing: 16) {
                    if let walk = store.walks.activeWalk {
                        Cap(walkElapsed(walk.duration(at: store.now)), v == "A" ? 56 : 32, .medium)
                        Cap("Started on \(walk.startedBy.rawValue)", 17).opacity(0.65)
                    } else {
                        Cap(store.walks.lastWalkLabel(at: store.now), 20, .medium, lines: 2)
                        Cap("\(Int(store.walks.history.first?.duration(at: store.now) ?? 0) / 60) min", 32, .medium)
                    }
                    if v == "A" {
                        Cap("\(store.walks.summary(at: store.now).weeklyMinutes) min this week", 17).opacity(0.65)
                        Cap("History ›", 17).opacity(0.65)
                    }
                }
            } br: {
                Button { store.toggleWalk() } label: {
                    Image(systemName: store.walks.activeWalk == nil ? "play.fill" : "stop.fill")
                        .font(.system(size: 24, weight: .semibold)).foregroundStyle(.black)
                        .frame(width: 64, height: 64).background(.green, in: .circle)
                }.buttonStyle(.plain)
                    .accessibilityLabel(store.walks.activeWalk == nil ? "Start walking Zero" : "Stop walking Zero")
            }
        }
    }
}

struct GridMedia: View {
    let v: String
    let store: any HomeDataSource
    var body: some View {
        Corners {
            Cap("Media", 22, .semibold)
        } tr: {
            Cap("\(store.media.items.count) items", 17).opacity(0.65)
        } bl: {
            VStack(alignment: .leading, spacing: 16) {
                if let item = store.media.items.first {
                    if v == "A" {
                        FixtureArtwork(tint: item.tint).frame(width: 152, height: 152)
                            .clipShape(.rect(cornerRadius: 20)).accessibilityHidden(true)
                    }
                    Cap(item.title, 26, .medium, lines: 2)
                }
                Cap(store.media.items.isEmpty ? "Library empty" : "Browse library ›", 17).opacity(0.65)
            }
        } br: { EmptyView() }
    }
}
