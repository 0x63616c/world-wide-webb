import SwiftUI

// Page-2 faces share the grid's ink inset and material; their providers and
// full-screen destinations are the same ones used by the legacy Home.
struct GridPhotos: View {
    let store: any HomeDataSource
    @Environment(\.motionPhase) private var phase
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
            } br: {
                EmptyView()
            }
        }.task(id: phase) {
            guard phase == nil else { return }
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
                        .accessibilityHidden(true).id(asset).transition(.opacity)
                }
                LinearGradient(
                    colors: [.black.opacity(0.45), .clear, .black.opacity(0.75)], startPoint: .top, endPoint: .bottom)
                caption
            }.frame(width: proxy.size.width, height: proxy.size.height)
                .clipShape(.rect(cornerRadius: HomeGrid.radius))
        }
    }
}

struct GridSonosRooms: View {
    @Environment(\.homeIntegration) private var integration
    let v: String
    let store: any HomeDataSource
    var body: some View {
        Corners {
            Cap("Sonos rooms", 22, .semibold)
        } tr: {
            if let room = store.rooms.first, let artwork = integration?.artwork(room) {
                artwork.frame(width: 52, height: 52).clipped()
            } else {
                Image(systemName: "hifispeaker.fill").font(.system(size: 22))
            }
        } bl: {
            if v == "B" {
                VStack(alignment: .leading, spacing: 20) {
                    ForEach(store.rooms.prefix(4)) { room in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 12) {
                                if let artwork = integration?.artwork(room) {
                                    artwork.frame(width: 44, height: 44).clipped()
                                }
                                Cap(room.name, 20, .semibold, lines: 2)
                            }
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
        } br: {
            EmptyView()
        }
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
                    WifiQRHero(image: qr).frame(width: 180, height: 180)
                }
                Cap(store.wifi.ssid ?? "Not configured", 26, .medium, lines: 2)
                Cap(store.wifi.ssid == nil ? "Guest network unavailable" : "Tap to join ›", 17).opacity(0.65)
            }
        } br: {
            EmptyView()
        }
    }
}
